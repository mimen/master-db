# Verification artifacts

Evidence from production dives and verification runs: videos, Playwright traces, screenshots, and logs. Everything here except this file is gitignored, because the runs are hundreds of megabytes. Each run lives on the machine that produced it.

| Folder | Run | Audit |
|---|---|---|
| `2026-10-04-native-dive/` | Phone (Expo Go simulator) and desktop app dive, plus the unread comparison | [docs/audits/2026-10-04-native-dive.md](../docs/audits/2026-10-04-native-dive.md) |
| `2026-10-04-production-dive/` | Production dive and fix verification, self line only | [docs/audits/2026-10-04-production-dive.md](../docs/audits/2026-10-04-production-dive.md) |

Each run folder holds:
- `report/*.mp4`, the videos;
- one directory per dive step, with `log.txt`, screenshots, `trace.zip` and `observed.json`;
- `scripts/`, the dive scripts that produced it.

Open a trace with `bunx playwright show-trace <run>/<step>/trace.zip`.
