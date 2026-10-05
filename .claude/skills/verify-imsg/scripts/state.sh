# Sourced by every script: the checkout root and its own state dir, so parallel worktrees never
# share a pid file or evidence. The name is the checkout's basename plus a hash of its full path.
repo="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
state="${TMPDIR:-/tmp}/verify-imsg/$(basename "$repo")-$(printf %s "$repo" | shasum | cut -c1-8)"
