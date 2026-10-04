---
deployment_status: partial
deployment_production_trigger: surface-specific; Comma auto-deploys on merge to main
deployment_branch_command: surface-specific; Comma uses cd apps/imsg && bun run deploy:branch
deployment_verify_command: surface-specific; Comma uses cd apps/imsg && bun run deploy:verify
deployment_last_assessed: 2026-08-23
deployment_targets:
  - component: Convex backend
    where: convex
    detail: Shared master-db deployment shiny-gerbil-853; backend publishing is separate from imsg deployment
    url: https://shiny-gerbil-853.convex.cloud
  - component: Todoist web app
    where: heroku
    detail: Docker web process configured by heroku.yml and Dockerfile
    url: https://convex-db-master-d31d50f579b2.herokuapp.com
  - component: imsg server
    where: mac-mini
    detail: launchd com.milad.imsg; GitHub Actions self-hosted Mini runner deploys origin/main
    url: https://milads-mac-mini.taild31e9a.ts.net:8447
  - component: imsg client
    where: mac-mini
    detail: Web export served by imsg server; Expo Go source served by launchd com.milad.imsg-expo on port 8081
    url: https://milads-mac-mini.taild31e9a.ts.net:8447
  - component: imsg desktop shell
    where: local-install
    detail: Comma.app installed in ~/Applications; Mini publishes immutable shell releases for laptop staging and activation
  - component: Agentic Engine
    where: mac-mini
    detail: launchd com.milad.agentic-engine runs ~/.agentic-engine/engine/deploy/start-with-secrets.sh
    url: https://milads-mac-mini.taild31e9a.ts.net:10000
---

# Master DB deployment

Master DB is a monorepo containing independently operated products and data surfaces. Deployment maturity is assessed per project; the repository is `partial` until those surfaces share a complete aggregate contract or each has its own verified runbook.

## Surface status

| Surface | Deployment status | Source of truth |
|---|---|---|
| Comma / imsg | Verified | [`apps/imsg/DEPLOY.md`](apps/imsg/DEPLOY.md) |
| Todoist / Convex data functions | Not set up through `/setup-deployment-system` | `convex/`, `convex.json`, and repo scripts |
| Other Convex-backed surfaces | Unassessed individually | Their project directories and deployment configuration |
| Root Heroku/container configuration | Partial evidence only | `heroku.yml` and `Dockerfile` |

Comma's verified status does not imply that Todoist, the broader Convex deployment, or other monorepo projects have completed deterministic deployment setup.

## Canonical commands

Comma commands run from `apps/imsg`:

```bash
bun run deploy:branch
bun run deploy:status
bun run deploy:verify
```

There is no repository-wide production, branch, or verification command covering every Master DB surface.

## Next setup boundary

Run `/setup-deployment-system` against each independently operated project when its deployment contract is being established. Keep its repo-relative `DEPLOY.md` authoritative and refresh the user-level project tracker after verification.
