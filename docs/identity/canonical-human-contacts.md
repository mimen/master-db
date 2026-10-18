# Canonical Human contacts

Master DB reads Human names and display contacts from Airtable. Every email and phone join key comes from AUF's canonical contact assignments, including secondary contacts and assignments beyond the old slot limits. The endpoint preserves AUF's redirect, revocation, and privacy-erasure behavior. Conflicted assignments remain available for matching, as in AUF's existing contact DTO reader.

`syncAirtableHumans` reads Airtable pages of 100 Human IDs and asks AUF for their contact assignments. It completes all reads before writing to the identity graph. Any failed contact read aborts the run. The existing `airtable-humans-sync` cron in `convex/crons.ts` runs every hour and still passes `link_only: true`, so unmatched Humans never create people.

`searchAirtableHumans` authorizes the caller before outbound reads. It searches names in Airtable and fetches canonical contacts for the matching IDs. Scalar `phone` and `email` retain Primary Phone and Primary Email display values, with canonical fallback. The `phones` and `emails` arrays carry every canonical handle through the client add-contact hook and `addPersonFromAirtable`. Older clients may still pass the optional scalar fields. Explicit add may create a person; the hourly sync may not.

## Configuration

The single credential is `op://AUF/AUF Canonical Contacts API Token/password`. Read it in memory and never log it. Set `AUF_CANONICAL_CONTACT_READ_TOKEN` on Master DB and `CANONICAL_CONTACT_READ_TOKEN` on AUF from that same value. Master DB also needs `AUF_CANONICAL_CONTACT_READ_URL`, the production AUF `.convex.site` URL ending in `/canonical-contacts/read`.

The POST body is exactly `{ "humanIds": ["recAAAAAAAAAAAAAA"] }`, with 1 to 100 valid Airtable Human IDs. Unknown keys, empty lists, and larger batches fail. There is no enumeration route or new public Convex RPC. Responses carry only Human ID, channel, value, and primary flag. The token grants no writes.

## Deployment and proof

1. Parent integrates the AUF endpoint and configures its token, then ships through AUF.network CI on main. Never deploy AUF locally.
2. Verify the deployed endpoint rejects missing/wrong authorization and invalid batches. Compare bounded real contact reads in memory; archive only counts and verdicts under the migration's mode-600 `C/` reports.
3. Configure Master DB's token and URL. Confirm the existing `.env.local` deployment marker is `dev:shiny-gerbil-853` without printing other variables.
4. Land the coordinated Master DB commit, then publish its backend with `CONVEX_DEPLOYMENT=dev:shiny-gerbil-853 bunx convex dev --once`. The recorded backend mechanism is `.github/workflows/deploy-imsg.yml`, which explicitly does not deploy Convex. Main changes under `apps/imsg` independently trigger the existing Comma deployment workflow.
5. Observe a real scheduled `identity/airtableSync:syncAirtableHumans` completion from the unchanged hourly cron. A manual invocation is not hourly proof. Record timestamp, success, and aggregate counts without contact values. Keep the retiring C slots until the coordinator accepts that proof.

Run `bun run test convex/identity`, `bun run typecheck:convex`, and scoped ESLint for these changes. The root `bun run test`, `bun run typecheck`, and `bun run lint` remain repository gates; record unrelated baseline failures explicitly rather than claiming they passed.
