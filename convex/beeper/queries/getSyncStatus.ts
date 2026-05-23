import { query } from "../../_generated/server";

/**
 * Aggregate Beeper sync health across accounts. One row per known account
 * plus rolled-up totals for dashboards.
 *
 * Avoids materialising the full messages table (would exceed Convex's 16 MB
 * per-query read limit at ~20k messages × multi-KB raw JSON). Instead, the
 * per-chat `message_count` cache is summed up from `beeper_chats`, which is
 * cheap because that table has one row per chat (hundreds, not tens of
 * thousands).
 */
export const getSyncStatus = query({
  handler: async (ctx) => {
    const accounts = await ctx.db.query("beeper_accounts").collect();
    const chats = await ctx.db.query("beeper_chats").collect();

    const accountStatus = accounts.map((a) => {
      const accountChats = chats.filter((c) => c.account_id === a.account_id);
      const messageCount = accountChats.reduce(
        (sum, c) => sum + (c.message_count ?? 0),
        0,
      );
      return {
        account_id: a.account_id,
        network: a.network,
        is_active: a.is_active,
        chat_count: accountChats.length,
        message_count: messageCount,
        last_full_sync_at: a.last_full_sync_at,
        last_incremental_sync_at: a.last_incremental_sync_at,
      };
    });

    const totalMessages = chats.reduce(
      (sum, c) => sum + (c.message_count ?? 0),
      0,
    );

    return {
      accounts: accountStatus,
      total_chats: chats.length,
      total_messages: totalMessages,
    };
  },
});
