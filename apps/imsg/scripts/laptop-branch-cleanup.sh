#!/usr/bin/env bash
# Runs branch cleanup from a dedicated, disposable main checkout.
set -euo pipefail
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CHECKOUT="${COMMA_CLEANUP_CHECKOUT:-$HOME/.cache/comma-deploy-source}"
REPOSITORY="${COMMA_REPOSITORY:-git@github.com:mimen/master-db.git}"
if [ ! -d "$CHECKOUT/.git" ]; then
  rm -rf "$CHECKOUT"
  git clone --filter=blob:none "$REPOSITORY" "$CHECKOUT"
fi
git -C "$CHECKOUT" fetch -q origin main
git -C "$CHECKOUT" checkout -q main
git -C "$CHECKOUT" reset -q --hard origin/main
bun install --frozen-lockfile --cwd "$CHECKOUT/apps/imsg"
exec -a comma:cleanup bun run --cwd "$CHECKOUT/apps/imsg" deploy:cleanup --apply
