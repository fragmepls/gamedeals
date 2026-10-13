# Learning Log

## 2026-10-12: Phase 1 done, first Dockerfile

### What we did
- Set up the project structure: `api/`, `poller/`, `db/init.sql`, `web/` and `k8s/` placeholders, `.env.example`, `.gitignore`
- API (Fastify) and poller (one-shot script) running locally against Postgres, no containers
- First real poll run: Hades stored with 3 shop prices and its historic low
- Started phase 2: wrote `api/Dockerfile` (multi-stage), reviewed and fixed it

### Concepts
- **Config through env vars only:** `npm run dev` loads `../.env`, `npm start` expects real env vars (the way Docker/K8s will provide them)
- **Listening on `0.0.0.0`:** listen on all interfaces, not just localhost (matters inside containers)
- **SIGTERM handling:** Docker/K8s stop a process with SIGTERM; the API closes the server and DB pool, then exits cleanly
- **Exit codes:** the poller exits non-zero on failure so a scheduler (later a CronJob) can tell the run failed
- **Multi-stage builds:** the builder stage has dev deps + TypeScript and compiles to `dist/`; the deps stage installs production deps only; the final image copies just `dist/` + prod `node_modules`, so no compiler or dev tools ship
- **Layer caching:** copy `package.json` + lockfile before `npm ci`, and the source after, so code changes don't reinstall deps
- **Running as non-root:** `--chown` alone isn't enough; `USER node` is what makes the process run as non-root

### Mistakes and fixes
- **Two Postgres installs on port 5432:** an old EDB-installer Postgres (password-protected) held the port, so the Homebrew one couldn't start. Fixed by uninstalling EDB and switching to Homebrew (`brew services start postgresql@18`). Leftover: `/Library/PostgreSQL/18/Library` (protected by macOS, harmless)
- **Stale process on a port:** an old API test was still listening on 3456 and answered instead of the new one. Found with `lsof`, stopped with `kill -TERM`
- **`sudo rm -rf` with a relative `../../..` path:** worked, but risky; type absolute paths for destructive commands
- **Dockerfile:**
  - `npm ci` ran before the package files were copied in
  - typo: `npm run buildn`
  - the `deps` stage was empty, so its `node_modules` didn't exist
  - no `USER node`
  - `package.json` was missing in the final image (it holds `"type": "module"`)

### Useful commands
```sh
lsof -nP -iTCP:5432 -sTCP:LISTEN      # who is listening on a port
pg_isready                            # is Postgres accepting connections
brew services list / start / stop
psql -d gamedeals -c '\dt'            # list tables
docker build -t gamedeals-api ./api
docker images / docker history gamedeals-api
docker run --rm -p 3000:3000 --env-file .env gamedeals-api
docker ps / docker logs <id> / docker exec -it <id> sh
```

### Next
- Write `api/.dockerignore` (`node_modules`, `dist`, `.env`)
- Start Docker Desktop, build and run the API image; work out why `localhost` in `DATABASE_URL` doesn't reach Postgres from inside the container
- Dockerfile for the poller, then `docker-compose.yml`

## 2026-10-13: Containerised API and poller

### What we did
- Wrote `.dockerignore` for `api/` and `poller/`
- Started Docker Desktop (already installed via Homebrew; no Colima needed)
- Built and ran the API image; reached the Mac's Postgres via `host.docker.internal`, `/health` → 200
- Wrote the poller Dockerfile; tested success and failure runs and checked their exit codes

### Concepts
- **Network namespaces:** each container has its own network stack and its own `localhost`. `localhost:5432` inside the container is the container itself, not the Mac
- **Docker on macOS:** containers need a Linux kernel, so Docker Desktop runs a small Linux VM (Colima/OrbStack are alternatives)
- **`host.docker.internal`:** Docker Desktop's hostname for the host machine. A workaround; with Compose, containers reach each other by service name
- **`-p host:container`** publishes a container port on the Mac; `-e` overrides a value from `--env-file`
- **Reading `docker run` usage:** `[OPTIONS] IMAGE [COMMAND]`: options go before the image name, anything after it is the container's command
- **Image size:** ~98% of the image is the `node:24-alpine` base (the Node runtime); my layers are prod `node_modules` (API 16 MB, poller 1 MB) + `dist`. "Content size" = compressed, "disk usage" = unpacked
- **Only the final stage ships:** `COPY . .` happens in the builder stage, so the runner stage only gets what is explicitly copied with `--from`
- **BuildKit runs independent stages in parallel** (deps and builder)
- **One-shot containers:** the poller exits when done; the exit code is the only signal (0 = ok, 1 = failed), which is what a CronJob will use later
- **`docker inspect` shows all env vars in plain text**, including secrets

### Mistakes and fixes
- `.dockerignore` typos (`node_module`, `dists`): names must match exactly
- `docker run` without an image name → "requires at least 1 argument"
- Thought Docker needed Colima, but Docker Desktop was already installed and just not running (`open -a Docker`)
- Remembered the wrong-country run as exit 0; `docker ps -a` showed it was exit 1 (`Unknown Country 'EU'`). Check exit codes instead of relying on memory
- Changing `ITAD_COUNTRY` (US → AT) mixed USD and EUR rows in the price history
- `.env.example` was renamed to `.env` instead of copied; recreated it

### Useful commands
```sh
open -a Docker && docker version
docker build --progress=plain -t gamedeals-api ./api
docker history gamedeals-api                       # size per layer
docker run --rm -p 3000:3000 --env-file .env -e DATABASE_URL=postgres://leonardoberrauch@host.docker.internal:5432/gamedeals gamedeals-api
docker run --rm --entrypoint sh gamedeals-api -c 'whoami; du -sh node_modules'
docker ps -a                                       # includes exited containers + exit status
docker inspect --format '{{.State.ExitCode}}' <name>
docker logs <name>                                 # works on exited containers too
docker rm <name> / docker container prune
```

### Next
- Delete the old USD rows (`delete from price_snapshots where currency = 'USD'`), or start fresh with a Postgres container
- `docker-compose.yml`: API + poller + Postgres as a container, service-name DNS instead of `host.docker.internal`, a volume for the database data, `db/init.sql` to create the schema on first start
