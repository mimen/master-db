# Canonical Human contacts

Master DB reads Human names and display contacts from Airtable. Every email and phone join key comes from AUF's canonical contact assignments, including secondary contacts and assignments beyond the old slot limits. The endpoint returns a resolution for every requested Human, even when its contacts are empty or it is tombstoned. Master DB follows that evidence for stored Human links and reconciles source-owned identities after a complete successful snapshot. Conflicted assignments remain available for matching, as in AUF's existing contact DTO reader.

`syncAirtableHumans` reads Airtable pages of 100 Human IDs and asks AUF for their contact assignments. It completes all reads before writing to the identity graph. Any failed contact read aborts the run. The snapshot also reads all previously linked or source-owned Human IDs, so missing Airtable rows, redirects, and tombstones are reconciled. Identities use the existing `source_contact_id` field for per-Human ownership and the `by_source_contact` index. Withdrawal removes only that Human's `airtable_human` identities, then recomputes person aggregates from remaining identities. Apple, Beeper, manual, and other sources remain. The existing `airtable-humans-sync` cron in `convex/crons.ts` runs every hour and still passes `link_only: true`, so unmatched Humans never create people.

`searchAirtableHumans` authorizes the caller before outbound reads. It searches names in Airtable and fetches canonical contacts for the matching IDs. Scalar `phone` and `email` retain the Primary Phone and Primary Email formatting only when normalized membership in the canonical set is proven. Excluded primaries fall back to canonical values; empty canonical rows are omitted. The `phones` and `emails` arrays carry every canonical handle through the client add-contact hook and `addPersonFromAirtable`. Older clients may still pass the optional scalar fields. Explicit add may create a person; the hourly sync may not.

## Configuration

The single credential is `op://AUF/AUF Canonical Contacts API Token/password`. Read it in memory and never log it. Set `AUF_CANONICAL_CONTACT_READ_TOKEN` on Master DB and `CANONICAL_CONTACT_READ_TOKEN` on AUF from that same value. Master DB also needs `AUF_CANONICAL_CONTACT_READ_URL`, the production AUF `.convex.site` URL ending in `/canonical-contacts/read`.

The POST body is exactly `{ "humanIds": ["recAAAAAAAAAAAAAA"] }`, with 1 to 100 valid Airtable Human IDs. Unknown keys, empty lists, and larger batches fail. There is no enumeration route or new public Convex RPC. Responses carry contacts with Human ID, channel, value, and primary flag, plus `resolutions` entries with requested `humanId` and nullable `canonicalHumanId`. Master requires one unique resolution for every requested ID. Missing evidence aborts before writes. The token grants no writes.

## Deployment and proof

1. Parent integrates the AUF endpoint and configures its token, then ships through AUF.network CI on main. Never deploy AUF locally.
2. Verify the deployed endpoint rejects missing/wrong authorization and invalid batches. Compare bounded real contact reads in memory; archive only counts and verdicts under the migration's mode-600 `C/` reports.
3. Configure Master DB's token and URL. Confirm the existing `.env.local` deployment marker is `dev:shiny-gerbil-853` without printing other variables.
4. Land the coordinated Master DB commit, then publish its backend with `CONVEX_DEPLOYMENT=dev:shiny-gerbil-853 bunx convex dev --once`. The recorded backend mechanism is `.github/workflows/deploy-imsg.yml`, which explicitly does not deploy Convex. Main changes under `apps/imsg` independently trigger the existing Comma deployment workflow.
5. Complete the separately reviewed legacy cleanup below before enabling a successful canonical hourly run.
6. Observe a real scheduled `identity/airtableSync:syncAirtableHumans` completion from the unchanged hourly cron. A manual invocation is not hourly proof. Record timestamp, success, and aggregate counts without contact values. Keep the retiring C slots until the coordinator accepts that proof.

Run `bun run test convex/identity`, `bun run typecheck:convex`, and scoped ESLint for these changes. The root `bun run test`, `bun run typecheck`, and `bun run lint` remain repository gates; record unrelated baseline failures explicitly rather than claiming they passed.

## Existing-data cleanup gate

Existing `airtable_human` identities without `source_contact_id` cannot prove per-Human ownership. The hourly action refuses to write while any remain. Deploying this code does not authorize their deletion. The separate internal action `identity/airtableSync:reconcileLegacyAirtableHumans` defaults to a read-only preview and returns only counts. It reads every Airtable Human and every previously linked or owned Human through the bounded endpoint before preparing reconciliation.

Before applying, the coordinator must review the preview, archive affected Airtable-source identities and person links in a mode-600 contact archive, and explicitly approve the existing-data cleanup. Invoke the same internal action with `{ "apply": true }` only after that approval. It creates current per-Human canonical identities using the existing links and matching semantics, reconciles proven redirects/withdrawals, then removes unowned legacy Airtable-source identities and recomputes aggregates. It preserves all other source rows. A failed fetch or incomplete resolution causes no writes. Mutation failures can leave completed batches, so rerun after fixing the failure; each batch and legacy cleanup is idempotent.

The full cleanup is a separate bulk operation, not part of the cron. The existing hourly interval remains unchanged. Do not claim revocation cleanup or hourly proof until the approved cleanup and a real subsequent scheduled run succeed.
