# Canonical migration preview

Run the candidate reconciliation offline against restricted snapshots before deciding on legacy cleanup. Nothing here deploys Master or calls a live mutation. The existing hourly job remains active.

## Capture

Run from this worktree. `python3 scripts/canonical-preview/capture.py` captures only live Master people and identities through inline readonly queries. Output is mode 600 in a new timestamped mode-700 directory under the approved C archive. Only counts and a digest reach stdout.

After the coordinator releases the Airtable lane and proves the resolutions endpoint live, run `python3 scripts/canonical-preview/capture.py --complete --airtable-lane-released`. This refreshes Master snapshots, fully enumerates native Human display and primary fields, and reads canonical assignments/resolutions in batches of at most 100 IDs. It uses the existing configured credentials in memory, never prints them, and denies redirects. Airtable pages are paced below two requests per second.

Snapshots are paginated observations, not a cross-service frozen transaction. Refresh before any approved apply and compare the new preview. Each capture gets a new directory; replay refuses to overwrite existing outputs. Original evidence stays intact.

## Replay

Set `CANONICAL_PREVIEW_INPUT` to the restricted `round2-master-db-preview-input.json` and `CANONICAL_PREVIEW_OUTPUT` to a restricted C output prefix, then run `bunx vitest run scripts/canonical-preview/replay.test.ts`. Capture stdout/stderr into a mode-600 file. Real-data failures are replaced by a fixed generic message; do not remove that wrapper to debug live inputs.

The operator seeds an in-memory convex-test database, preserving person references and row insertion order. It invokes the actual candidate preview action and reconciliation mutations locally, predicts retirement inside a rolled-back local transaction, and validates the exact plan through the real retirement mutation. All fetch calls are intercepted; only captured native pages and captured canonical responses are returned. Unknown URLs/methods fail. No remote Convex client or write credential is used by replay. Person storage-photo pointers are omitted from the local seed because storage is not consulted by reconciliation; original snapshots remain intact.

The details file includes `reviewedPlan`, with original live IDs and initial/cards/replacement/before-removal/after-removal fingerprints for approval and later apply. It also contains per-Human native display, canonical proof, original source rows and resulting provenance; per-person before/after sets and aggregate fields; and individual dispositions for every person without an independent source. Legacy rows without provenance are attributed to the person's stored Human link for comparison, not asserted to have historical ownership. All original rows remain in the input snapshot.

The summary separates deleted legacy rows, replacement rows, genuinely removed global identifiers, removed/added person-identifier pairs, link changes, and people losing all identifiers. It asserts byte-for-byte preservation of independent source rows in the local database. Details and summary are mode 600. Print only the summary.

## Gate

This operator is evidence, not cleanup authorization. Do not deploy a fail-closed candidate merely to preview. Coordinator review, endpoint live proof, complete replacement preview, and the resulting cleanup decision precede activation. No live cleanup has been executed.
