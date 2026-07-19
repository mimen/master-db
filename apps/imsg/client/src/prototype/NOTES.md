# Inbox design prototype

**Question:** Which inbox hierarchy best reduces control and row density while preserving native iMessage familiarity on mobile and desktop?

## Variants

- `quiet` — Quiet Native
- `shelf` — Priority Shelf
- `rhythm` — Adaptive Rhythm
- `lens` — Focus Lens
- `rail` — Triage Rail

Open `/prototype?variant=quiet` in a development build. Use the floating arrows or keyboard Left/Right to compare.

## Verdict

**Winner: Priority Shelf (`shelf`).** Selected by Milad on 2026-07-18.

What won: the compact native filter strip, horizontally scannable “Needs You” shelf, and generous two-line chronological rows provide the clearest reduction in density without losing iMessage familiarity.

Next: rewrite this direction into the production inbox, then delete this directory and `src/app/prototype.tsx`.
