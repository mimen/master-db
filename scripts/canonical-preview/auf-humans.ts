// Prints every AUF Human, names only, as one JSON array: capture.py's complete read.
// Reads AUF_CONVEX_URL and AUF_COMMA_JWT_PRIVATE_KEY from the environment capture.py passes.
import type { AufHumansPage } from "../../convex/identity/airtableSync";
import { aufIdentityQuery } from "../../convex/identity/aufConvex";

const rows: AufHumansPage["page"] = [];
let cursor: string | null = null;
for (let pages = 0; ; pages++) {
  if (pages >= 1000) throw new Error("AUF Humans exceeded the complete-read page limit");
  const body: AufHumansPage = await aufIdentityQuery<AufHumansPage>("humans", { paginationOpts: { cursor, numItems: 100 } });
  rows.push(...body.page);
  if (body.isDone) break;
  cursor = body.continueCursor;
}
process.stdout.write(JSON.stringify(rows));
