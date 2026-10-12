# Game Deal Tracker

A small app that tracks game prices across stores (via the IsThereAnyDeal API), stores price history, and sends alerts when a wishlisted game hits a target price or historic low.

**Primary goal: learning Docker and Kubernetes.** The app is deliberately simple; the infrastructure is the point.

## Stack
- **API + worker:** TypeScript / Node.js (Fastify or Express)
- **Frontend:** React + TypeScript (Vite)
- **Database:** PostgreSQL
- **Data source:** IsThereAnyDeal API (needs an API key — docs: https://docs.isthereanydeal.com)
- **Alerts:** Discord webhook
- **Local K8s:** k3d (or kind)

## Services
- `api/` – REST API: wishlist CRUD, price history, current deals
- `poller/` – fetches prices for wishlisted games, writes to Postgres, triggers alerts. Runs as a one-shot script (later a K8s CronJob), not a long-running loop.
- `web/` – dashboard: wishlist, price charts, deal list
- `k8s/` – manifests (plain YAML first)

## Roadmap
1. **App basics** – API + poller + Postgres running locally, no containers
2. **Docker** – Dockerfile per service (multi-stage), then `docker-compose.yml` for the whole stack
3. **Kubernetes basics** – k3d cluster; Deployments, Services, ConfigMap, Secret, Postgres StatefulSet + PVC
4. **Kubernetes extras** – poller as CronJob, Ingress, readiness/liveness probes, rolling updates
5. **CI/CD** – GitHub Actions: build, push to GHCR, deploy
6. **Optional** – Kustomize/Helm (only once the YAML repetition hurts), Argo CD, real k3s server

## How to work with me (learning mode)
- **I write the Docker and Kubernetes files myself.** Don't generate a Dockerfile, compose file or manifest unless I explicitly ask. Instead: explain the concept, point to what's needed, then review what I wrote.
- **I want to do git commits myself.** Don't commit for me; I want to learn the workflow.
- **Explain the why** before the how: what problem a concept solves, and what would break without it.
- **Small steps.** One concept at a time; make sure it runs before moving on.
- **Review like a mentor:** point out mistakes and bad practices, and ask guiding questions before handing me the fix.
- **Show me the commands** to inspect things (`docker logs`, `kubectl describe`, `kubectl get events`, etc.) so I learn to debug myself.
- **App code is fair game** – you can write more of the TypeScript/React code so I can focus on infra, but keep it minimal.
- **Keep it simple.** No extra tools, abstractions or services unless they teach something on the roadmap.
- **Learning log:** when I say I'm wrapping up (or at the end of a session), append an entry to `NOTES.md` in the repo root: date, what we did, concepts I learned (in my own words where possible), mistakes and how we fixed them, useful commands, and what's next. Read `NOTES.md` at the start of each session to pick up where we left off.

## Conventions
- Secrets never committed; use `.env` (gitignored) locally and K8s Secrets in the cluster. Keep a `.env.example`.
- Config via environment variables only.
- Every service exposes `GET /health` (used later for probes).
