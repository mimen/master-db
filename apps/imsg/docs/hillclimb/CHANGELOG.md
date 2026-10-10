# Comma hill-climb changelog

One entry per landed change, newest first. Each entry gives the date, the commit, what changed for the user, the metric before and after, and how to revert.

## 2026-10-10. Tapbacks, edits, unsend and delete land on the frame you act (3bf6fd43)

- **For the user:** a tapback, an edit, Undo send and Delete for Me now show on the frame of the click. If the Mac mini rejects one, it reverts with a toast. Before, a tapback showed after a server round trip, and the other three waited for it.
- **Metric 2 (non-optimistic interactions):** 84 became 80. `e2e/bench/optimistic.ts`, fixture with tailnet shaping, p75: tapback add 298 to 15 ms, tapback remove 465 to 15 ms, unsend 399 to 15 ms.
- **Ratchet:** `ratchet.playwright.ts` requires the tapback badge within 50 ms of the click, and requires the badge to roll back with a toast under an injected bridge fault.
- **Revert:** `git revert 3bf6fd43`.

## 2026-10-10. Contacts loads on first visit, not at boot (c744ed02)

- **For the user:** the conversation list appears sooner on a fresh load, because the 440 KB contacts list no longer downloads alongside it. Contacts still opens instantly after its first visit.
- **Metric 1a (first-visit cold load, real data, p75):** 936 to 1,383 ms on production became 753 to 815 ms on the branch preview, measured in three interleaved rounds of five.
- **Ratchet:** `e2e/fixture/ratchet.playwright.ts` fails if Contacts mounts at boot. It runs in `validate-imsg.yml`.
- **Revert:** `git revert` c744ed02.

## 2026-10-10. Measurement harness

- **For the user:** nothing changes. This lands the benchmarks every later entry is measured with.
- **Metric:** baselines recorded in [README.md](README.md).
- **Revert:** `git revert` this commit. No runtime code changed.
