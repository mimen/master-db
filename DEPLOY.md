---
deployment_status: partial
deployment_production_trigger: surface-specific; Comma auto-deploys on merge to main
deployment_branch_command: surface-specific; Comma uses cd apps/imsg && bun run deploy:branch
deployment_verify_command: surface-specific; Comma uses cd apps/imsg && bun run deploy:verify
deployment_last_assessed: 2026-08-23
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
