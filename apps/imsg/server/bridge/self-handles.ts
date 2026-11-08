import { Database } from "bun:sqlite";

/**
 * The handles Messages on this Mac signs in with, from chat.db's `chat.account_login` (`P:+15551234567`,
 * `E:me@example.com`): the iMessage account's selfHandles. Undefined when chat.db cannot be read, so the
 * account keeps the handles it has.
 */
export function readSelfHandles(chatDbPath = Bun.env.CHATDB_PATH ?? `${Bun.env.HOME}/Library/Messages/chat.db`): string[] | undefined {
  let db: Database | undefined;
  try {
    db = new Database(chatDbPath, { readonly: true });
    const logins = db.query<{ login: string }, []>("SELECT DISTINCT account_login AS login FROM chat WHERE account_login IS NOT NULL").all();
    return [...new Set(logins.flatMap(({ login }) => /^[PE]:(.+)$/.exec(login)?.[1] ?? []))].sort();
  } catch (error) {
    console.warn(`comma bridge: chat.db unavailable, the account keeps its selfHandles. ${String(error)}`);
    return undefined;
  } finally {
    db?.close();
  }
}
