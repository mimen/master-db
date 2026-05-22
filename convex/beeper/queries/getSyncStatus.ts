import { query } from "../../_generated/server";

/**
 * Aggregate Beeper sync health across accounts. Returns one entry per known
 * account plus rolled-up counts for the dashboard's sync widget.
 */
export const getSyncStatus = query({
  handler: async (ctx) => {
    const accounts = await ctx.db.query("beeper_accounts").collect();
    const chats = await ctx.db.query("beeper_chats").collect();
    const messages = await ctx.db.query("beeper_messages").collect();

    const accountStatus = accounts.map((a) => {
      const accountChats = chats.filter((c) => c.account_id === a.account_id);
      const accountMessages = messages.filter(
        (m) => m.account_id === a.account_id,
      );
      return {
        account_id: a.account_id,
        network: a.network,
        is_active: a.is_active,
        chat_count: accountChats.length,
        message_count: accountMessages.length,
        last_full_sync_at: a.last_full_sync_at,
        last_incremental_sync_at: a.last_incremental_sync_at,
      };
    });

    return {
      accounts: accountStatus,
      total_chats: chats.length,
      total_messages: messages.length,
    };
  },
});
