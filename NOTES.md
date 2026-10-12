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
