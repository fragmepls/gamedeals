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

## 2026-10-14/15: Docker Compose

### What we did
- Wrote `docker-compose.yaml`: `db` (Postgres), `api` and `poller`, all started with one command
- Postgres now runs as a container (`postgres:18-alpine`) with a named volume; `db/init.sql` creates the schema on first start
- `api` and `poller` reach the database by service name (`db`), no more `host.docker.internal`
- Healthcheck on `db`, so `api` and `poller` only start once Postgres accepts connections
- Full flow works in containers: POST a game → poller run → `/wishlist` shows EUR prices

### Concepts
- **Compose = the whole stack in one declarative file.** Describe the desired state, Compose creates it (the same idea Kubernetes uses)
- **Compose network + DNS:** every service is reachable by its service name (`postgres://...@db:5432/...`)
- **Image reference = `repository:tag`.** `postgres:18-alpine`; a tag alone (`18-alpine`) isn't a valid image. Tags like `18`, `18-trixie`, `18-bookworm` and `18-alpine` are variants of the same image with different base OSes
- **`image:` vs `build:`:** use a ready-made image vs build from a Dockerfile in a folder
- **Ports `"host:container"`:** one string; the right side is the port the app listens on inside the container, the left side is what I `curl` on the Mac. A single number publishes on a random host port. `db` publishes no port at all: other containers reach it over the Compose network
- **Named volume vs bind mount:**
  - `pgdata:/var/lib/postgresql` = storage managed by Docker that survives `down`
  - `./db/init.sql:/docker-entrypoint-initdb.d/init.sql` = a file from the repo mounted into the container
  - Named volumes must also be declared under the top-level `volumes:`
- **Postgres 18 changed the data path:** mount `/var/lib/postgresql`, not the old `/var/lib/postgresql/data` from older tutorials
- **Init scripts only run on an empty data directory** (first start). Schema changes later need `down -v` (wipes data) or a migration
- **`depends_on` alone only waits for "container started"**; with `condition: service_healthy` + a `healthcheck` it waits for "ready"
- **Healthcheck:** runs inside the container, so it has to use tools in that image (`pg_isready`, not `curl`). `CMD` runs without a shell; `CMD-SHELL` expands variables
- **Three ways `.env` is used:**
  1. **Interpolation:** Compose reads `.env` automatically and replaces `${VAR}` in the YAML on the host, before anything starts
  2. **`env_file:`** copies every line of `.env` into that container's environment at runtime
  3. **`$${VAR}`** escapes interpolation, so the shell inside the container expands it from the container's environment
- **Least privilege:** `db` gets only the Postgres variables via `environment:`, not the whole `.env` (it doesn't need the ITAD key)
- **`${VAR:?message}`** makes Compose fail loudly when a variable is missing, instead of silently using an empty string
- **`docker compose config` prints secrets in plain text.** Use `config -q` to validate and `config --variables` to list the variables used

### Mistakes and fixes
- YAML: two `key:` pairs on one line (`depends_on: condition: ...`), so each level needs its own line and indentation
- `env-file` → `env_file` (Compose keys use underscores)
- Ports written as YAML keys (`- host: 5432`, `- container: 5432`) and with the wrong port (5432 is Postgres, the API listens on 3000)
- `image: ./db`, `image: alpine3.24` and `image: 18-alpine` → `postgres:18-alpine`
- Healthcheck copied from the docs used `curl localhost:8080`, but Postgres has no HTTP and no curl → `pg_isready`
- `DATABASE_URL` with `localhost` (same mistake as with plain Docker) → service name `db`
- An unused `DATABASE_PASSWORD` variable and a hardcoded password in the compose file → `${POSTGRES_PASSWORD}` from `.env` inside the URL
- `POSTGRES_DB=gamedeal` vs `.../gamedeals` in the URL
- `poller` depended on `api` being healthy (api has no healthcheck, and the poller only needs `db`)
- Empty top-level `volumes:` → "volumes must be a mapping"
- `curl` POST → `400 "Client Error"` with nothing in the API logs: the HTTP request itself was malformed (copy-pasted curly quotes / hidden characters). Fixed by typing the command by hand. Debug with `curl -v` and `pbpaste | cat -v`
- Claude sent a test POST itself, so Hades was already in the DB → my own POST got `409 already on the wishlist`

### Useful commands
```sh
docker compose config -q                         # validate (silent = OK)
docker compose config --variables                # which ${VARS} the file uses
docker compose up -d --build
docker compose ps -a                             # health status + exited one-shot containers
docker compose logs -f api / docker compose logs db | grep init.sql
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose run --rm poller
docker compose down                              # stop + remove containers, volume stays
docker compose down -v                           # ... and DELETE the volume (all data)
docker volume ls / docker volume inspect dev_pgdata
curl -v ...                                      # see exactly what curl sends
```

### Next
- Done afterwards: persistence test passed (Hades survived `down`/`up`), removed `env_file` from `db`, `${VAR:?}` on the Postgres variables, quoted ports. **Phase 2 is complete**
- Commit the final `docker-compose.yaml` changes (they were still uncommitted)
- **Phase 3: Kubernetes basics**: k3d cluster, Deployments, Services, ConfigMap, Secret, Postgres StatefulSet + PVC
