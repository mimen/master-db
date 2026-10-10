# Comma hill-climb changelog

One entry per landed change, newest first. Each entry gives the date, the commit, what changed for the user, the metric before and after, and how to revert.

## 2026-10-10. Contacts loads on first visit, not at boot

- **For the user:** the conversation list appears sooner on a fresh load, because the 440 KB contacts list no longer downloads alongside it. Contacts still opens instantly after its first visit.
- **Metric 1a (first-visit cold load, real data, p75):** 936 to 1,383 ms on production became 753 to 815 ms on the branch preview, measured in three interleaved rounds of five.
- **Ratchet:** `e2e/fixture/ratchet.playwright.ts` fails if Contacts mounts at boot. It runs in `validate-imsg.yml`.
- **Revert:** `git revert` the commit `perf(imsg): mount Contacts on first visit, not at boot`.

## 2026-10-10. Measurement harness

- **For the user:** nothing changes. This lands the benchmarks every later entry is measured with.
- **Metric:** baselines recorded in [README.md](README.md).
- **Revert:** `git revert` this commit. No runtime code changed.
