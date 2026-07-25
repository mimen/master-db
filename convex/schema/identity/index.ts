// Barrel export for the cross-network identity graph (Convex-canonical).
export { chat_crm } from "./chat_crm";
export { event_links } from "./event_links";
export { identities } from "./identities";
export { people } from "./people";
// SUPERSEDED by `tags` — kept only until migratePersonTags (admin.ts) has run
// everywhere with data; see person_tags.ts's docstring for the removal order.
export { person_tags } from "./person_tags";
export { tags } from "./tags";
