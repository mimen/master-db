/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";
import type { GenericId as Id } from "convex/values";

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: {
  agentic: {
    actions: {
      postInterrupt: {
        default: FunctionReference<
          "action",
          "public",
          { entity_ref: string },
          any
        >;
      };
      postRun: {
        default: FunctionReference<
          "action",
          "public",
          {
            entity_ref: string;
            idempotency_key: string;
            message: string | null;
            multitask_strategy?: string;
            webhook?: string;
            webhook_token?: string;
          },
          any
        >;
      };
    };
    dev: {
      seed: {
        seedSpikeThread: FunctionReference<"mutation", "public", {}, any>;
      };
    };
    mutations: {
      appendThreadMessage: {
        default: FunctionReference<
          "mutation",
          "public",
          {
            body_markdown: string | null;
            checkpoint_id: string | null;
            entity_ref: string;
            error_json: any | null;
            kind: string;
            proposal_json: any | null;
            run_id: string;
            token_usage: any | null;
          },
          any
        >;
      };
      recordActivity: {
        resolve: FunctionReference<
          "mutation",
          "public",
          {
            id: Id<"agenticThreadActivities">;
            output_json: any | null;
            status: string;
          },
          any
        >;
        start: FunctionReference<
          "mutation",
          "public",
          {
            entity_ref: string;
            input_json: any;
            kind: string;
            name: string;
            run_id: string;
          },
          any
        >;
      };
      updateRunStatus: {
        default: FunctionReference<
          "mutation",
          "public",
          {
            entity_ref: string;
            last_message_id: Id<"agenticThreadMessages"> | null;
            resume_cursor: any | null;
            status: string;
          },
          any
        >;
      };
      upsertRun: {
        default: FunctionReference<
          "mutation",
          "public",
          {
            backend: string;
            entity_id: string;
            entity_ref: string;
            entity_type: string;
            resume_cursor: any | null;
            run_id: string;
            status: string;
            traceparent: string | null;
          },
          any
        >;
      };
    };
    queries: {
      agentOverlayByEntityRefs: {
        default: FunctionReference<
          "query",
          "public",
          { entity_refs: Array<string> },
          any
        >;
      };
      getActivities: {
        default: FunctionReference<"query", "public", { run_id: string }, any>;
      };
      getQueueEntityMeta: {
        default: FunctionReference<
          "query",
          "public",
          { entity_ref: string },
          any
        >;
      };
      getRun: {
        default: FunctionReference<
          "query",
          "public",
          { entity_ref: string },
          any
        >;
      };
      getThread: {
        default: FunctionReference<
          "query",
          "public",
          { entity_ref: string },
          any
        >;
      };
      listAwaitingDecision: {
        default: FunctionReference<
          "query",
          "public",
          {
            closed?: boolean;
            limit?: number;
            sort?: string;
            statuses?: Array<string>;
          },
          any
        >;
      };
    };
  };
  auth: {
    isAuthenticated: FunctionReference<"query", "public", {}, any>;
    signIn: FunctionReference<
      "action",
      "public",
      {
        calledBy?: string;
        params?: any;
        provider?: string;
        refreshToken?: string;
        verifier?: string;
      },
      any
    >;
    signOut: FunctionReference<"action", "public", {}, any>;
  };
  beeper: {
    queries: {
      getAttachmentUrl: {
        getAttachmentUrl: FunctionReference<
          "query",
          "public",
          { mxc_id: string },
          any
        >;
      };
      getMessagesByChat: {
        getMessagesByChat: FunctionReference<
          "query",
          "public",
          { before_ts_epoch_ms?: number; chat_id: string; limit?: number },
          any
        >;
      };
      getRecentChats: {
        getRecentChats: FunctionReference<
          "query",
          "public",
          { limit?: number; network?: string },
          any
        >;
      };
      getSyncStatus: {
        getSyncStatus: FunctionReference<"query", "public", any, any>;
      };
      searchMessages: {
        searchMessages: FunctionReference<
          "query",
          "public",
          {
            chat_id?: string;
            limit?: number;
            network?: string;
            query: string;
            sender_id?: string;
          },
          any
        >;
      };
    };
  };
  clear: {
    all: FunctionReference<"mutation", "public", any, any>;
    items: FunctionReference<"mutation", "public", any, any>;
    projects: FunctionReference<"mutation", "public", any, any>;
    syncState: FunctionReference<"mutation", "public", any, any>;
  };
  comma: {
    drafts: {
      clearDraft: FunctionReference<
        "mutation",
        "public",
        { conversationId: Id<"comma_conversations"> },
        null
      >;
      setDraft: FunctionReference<
        "mutation",
        "public",
        { conversationId: Id<"comma_conversations">; text: string },
        null
      >;
    };
    outbox: {
      enqueue: FunctionReference<
        "mutation",
        "public",
        {
          clientKey: string;
          conversationId: Id<"comma_conversations">;
          payload:
            | {
                kind: "send";
                mentions?: Array<{
                  address: string;
                  length: number;
                  start: number;
                }>;
                replyToGuid?: string;
                replyToPart?: number;
                text: string;
              }
            | {
                kind: "react";
                messageGuid: string;
                partIndex?: number;
                reaction: string;
                remove: boolean;
              }
            | {
                kind: "edit";
                messageGuid: string;
                partIndex?: number;
                text: string;
              }
            | { kind: "unsend"; messageGuid: string; partIndex?: number }
            | { kind: "delete"; messageGuid: string; partIndex?: number }
            | { kind: "markRead"; messageGuid?: string }
            | { kind: "markUnread"; messageGuid?: string }
            | { kind: "settle"; messageGuid?: string }
            | { kind: "unsettle"; messageGuid?: string }
            | { kind: "pin"; value: boolean }
            | { kind: "mute"; value: boolean }
            | { kind: "rename"; name: string }
            | { kind: "schedule"; sendAt: number; text: string }
            | {
                bbId: number;
                kind: "editScheduled";
                sendAt: number;
                text: string;
              }
            | { bbId: number; kind: "cancelScheduled" };
        },
        Id<"comma_outbox">
      >;
      outboxStatusFor: FunctionReference<
        "query",
        "public",
        { clientKeys: Array<string> },
        Array<{
          clientKey: string;
          error?: string;
          status: "pending" | "claimed" | "sent" | "failed" | "unknown";
        }>
      >;
      pendingOutbox: FunctionReference<
        "query",
        "public",
        { bridgeKey: string },
        Array<{
          _creationTime: number;
          _id: Id<"comma_outbox">;
          attempts: number;
          clientKey: string;
          conversationId: Id<"comma_conversations">;
          createdAt: number;
          error?: string;
          leaseUntil?: number;
          payload:
            | {
                kind: "send";
                mentions?: Array<{
                  address: string;
                  length: number;
                  start: number;
                }>;
                replyToGuid?: string;
                replyToPart?: number;
                text: string;
              }
            | {
                kind: "react";
                messageGuid: string;
                partIndex?: number;
                reaction: string;
                remove: boolean;
              }
            | {
                kind: "edit";
                messageGuid: string;
                partIndex?: number;
                text: string;
              }
            | { kind: "unsend"; messageGuid: string; partIndex?: number }
            | { kind: "delete"; messageGuid: string; partIndex?: number }
            | { kind: "markRead"; messageGuid?: string }
            | { kind: "markUnread"; messageGuid?: string }
            | { kind: "settle"; messageGuid?: string }
            | { kind: "unsettle"; messageGuid?: string }
            | { kind: "pin"; value: boolean }
            | { kind: "mute"; value: boolean }
            | { kind: "rename"; name: string }
            | { kind: "schedule"; sendAt: number; text: string }
            | {
                bbId: number;
                kind: "editScheduled";
                sendAt: number;
                text: string;
              }
            | { bbId: number; kind: "cancelScheduled" };
          resultGuid?: string;
          status: "pending" | "claimed" | "sent" | "failed" | "unknown";
          updatedAt: number;
        }>
      >;
    };
    queries: {
      getConversation: FunctionReference<
        "query",
        "public",
        { conversationId: Id<"comma_conversations"> },
        {
          _creationTime: number;
          _id: Id<"comma_conversations">;
          chatGuids: Array<string>;
          conversationKey: string;
          displayName: string;
          flags: {
            mutedUnresponded: boolean;
            pinned: boolean;
            unread: boolean;
            unresponded: boolean;
            waiting: boolean;
          };
          hasGroupPhoto: boolean;
          isGroup: boolean;
          isSpam: boolean;
          lastMessage?: {
            dateCreated: number;
            guid: string;
            hasAttachments: boolean;
            isFromMe: boolean;
            senderName: string | null;
            text: string;
          };
          lastMessageAt: number;
          participants: Array<{
            address: string;
            name: string | null;
            photoUrl?: string | null;
          }>;
          primaryChatGuid: string;
          unreadCount: number;
          updatedAt: number;
        } | null
      >;
      getDraft: FunctionReference<
        "query",
        "public",
        { conversationId: Id<"comma_conversations"> },
        {
          _creationTime: number;
          _id: Id<"comma_drafts">;
          conversationId: Id<"comma_conversations">;
          text: string;
          updatedAt: number;
        } | null
      >;
      getSuggestions: FunctionReference<
        "query",
        "public",
        { conversationId: Id<"comma_conversations"> },
        {
          _creationTime: number;
          _id: Id<"comma_suggestions">;
          anchorGuid: string;
          conversationId: Id<"comma_conversations">;
          createdAt: number;
          payload: {
            event: {
              durationMinutes: number;
              inviteEmails: Array<string>;
              location: string | null;
              start: string;
              title: string;
            } | null;
            fallback: boolean;
            noReply: boolean;
            recipeVersion: number;
            selectedModel: "opus" | "terra";
            servedModel: "opus" | "terra";
            suggestions: Array<{
              id: string;
              kind: "text" | "reaction";
              reaction: string | null;
              strategy: string;
              targetMessageGuid: string | null;
              targetMessagePreview: string | null;
              targetPartIndex: number | null;
              text: string;
              vibe: string;
            }>;
          };
        } | null
      >;
      listConversations: FunctionReference<
        "query",
        "public",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: Id<"comma_conversations">;
            chatGuids: Array<string>;
            conversationKey: string;
            displayName: string;
            flags: {
              mutedUnresponded: boolean;
              pinned: boolean;
              unread: boolean;
              unresponded: boolean;
              waiting: boolean;
            };
            hasGroupPhoto: boolean;
            isGroup: boolean;
            isSpam: boolean;
            lastMessage?: {
              dateCreated: number;
              guid: string;
              hasAttachments: boolean;
              isFromMe: boolean;
              senderName: string | null;
              text: string;
            };
            lastMessageAt: number;
            participants: Array<{
              address: string;
              name: string | null;
              photoUrl?: string | null;
            }>;
            primaryChatGuid: string;
            unreadCount: number;
            updatedAt: number;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listMessages: FunctionReference<
        "query",
        "public",
        {
          conversationId: Id<"comma_conversations">;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: Id<"comma_messages">;
            attachmentGuids: Array<string>;
            attachments: Array<{
              _creationTime: number;
              _id: Id<"comma_attachments">;
              conversationId: Id<"comma_conversations">;
              filename?: string;
              guid: string;
              height?: number;
              hideAttachment: boolean;
              isOnDisk: boolean;
              isSticker: boolean;
              messageGuid: string;
              mimeType?: string;
              originalStorageId?: Id<"_storage">;
              originalUrl: string | null;
              sourceVersion: number;
              thumbStorageId?: Id<"_storage">;
              thumbUrl: string | null;
              totalBytes?: number;
              transcript?: string;
              transferName?: string;
              transferState?: number;
              uti?: string;
              width?: number;
            }>;
            chatGuid: string;
            clientKey?: string;
            conversationId: Id<"comma_conversations">;
            dateCreated: number;
            dateDelivered?: number;
            dateEdited?: number;
            dateRead?: number;
            dateRetracted?: number;
            edited: boolean;
            error: number;
            guid: string;
            isFromMe: boolean;
            isGroupEvent: boolean;
            isSpam?: boolean;
            isTapback: boolean;
            mentions: Array<{ address: string; length: number; start: number }>;
            reactions: Array<{
              emoji?: string;
              isFromMe: boolean;
              senderAddress: string | null;
              senderName: string | null;
              type: string;
            }>;
            replyToFromMe?: boolean;
            replyToGuid?: string;
            replyToPreview?: string;
            retracted: boolean;
            sendEffect?: string;
            sender?: { address: string; name: string | null };
            service: "iMessage" | "SMS";
            sourceVersion: number;
            special?:
              | { kind: "contact"; name: string | null }
              | { kind: "location" }
              | { kind: "apple-cash" }
              | { kind: "poll" }
              | { kind: "unknown"; label: string };
            tapback?: {
              emoji?: string;
              reaction: string;
              remove: boolean;
              targetGuid: string;
            };
            tapbackTargetGuid?: string;
            text: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listScheduled: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"comma_scheduled">;
          bbId: number;
          chatGuid: string;
          conversationId?: Id<"comma_conversations">;
          error?: string;
          sendAt: number;
          sentAt?: number;
          status:
            | "pending"
            | "in-progress"
            | "complete"
            | "failed"
            | "interrupted"
            | "expired";
          text: string;
          updatedAt: number;
        }>
      >;
      resolveChat: FunctionReference<
        "query",
        "public",
        { chatGuid: string },
        {
          _creationTime: number;
          _id: Id<"comma_conversations">;
          chatGuids: Array<string>;
          conversationKey: string;
          displayName: string;
          flags: {
            mutedUnresponded: boolean;
            pinned: boolean;
            unread: boolean;
            unresponded: boolean;
            waiting: boolean;
          };
          hasGroupPhoto: boolean;
          isGroup: boolean;
          isSpam: boolean;
          lastMessage?: {
            dateCreated: number;
            guid: string;
            hasAttachments: boolean;
            isFromMe: boolean;
            senderName: string | null;
            text: string;
          };
          lastMessageAt: number;
          participants: Array<{
            address: string;
            name: string | null;
            photoUrl?: string | null;
          }>;
          primaryChatGuid: string;
          unreadCount: number;
          updatedAt: number;
        } | null
      >;
      searchMessages: FunctionReference<
        "query",
        "public",
        { conversationId?: Id<"comma_conversations">; query: string },
        Array<{
          _creationTime: number;
          _id: Id<"comma_messages">;
          attachmentGuids: Array<string>;
          chatGuid: string;
          clientKey?: string;
          conversationId: Id<"comma_conversations">;
          dateCreated: number;
          dateDelivered?: number;
          dateEdited?: number;
          dateRead?: number;
          dateRetracted?: number;
          edited: boolean;
          error: number;
          guid: string;
          isFromMe: boolean;
          isGroupEvent: boolean;
          isSpam?: boolean;
          isTapback: boolean;
          mentions: Array<{ address: string; length: number; start: number }>;
          reactions: Array<{
            emoji?: string;
            isFromMe: boolean;
            senderAddress: string | null;
            senderName: string | null;
            type: string;
          }>;
          replyToFromMe?: boolean;
          replyToGuid?: string;
          replyToPreview?: string;
          retracted: boolean;
          sendEffect?: string;
          sender?: { address: string; name: string | null };
          service: "iMessage" | "SMS";
          sourceVersion: number;
          special?:
            | { kind: "contact"; name: string | null }
            | { kind: "location" }
            | { kind: "apple-cash" }
            | { kind: "poll" }
            | { kind: "unknown"; label: string };
          tapback?: {
            emoji?: string;
            reaction: string;
            remove: boolean;
            targetGuid: string;
          };
          tapbackTargetGuid?: string;
          text: string;
        }>
      >;
      syncStatus: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"comma_sync_state">;
          counts?: Record<string, number>;
          cursor?: string;
          key: string;
          lastEventAt?: number;
          lastReconcileAt?: number;
          updatedAt: number;
        }>
      >;
    };
  };
  dashboard: {
    queries: {
      getDashboardStats: {
        getDashboardStats: FunctionReference<
          "query",
          "public",
          { timezoneOffsetMinutes?: number },
          any
        >;
      };
    };
  };
  identity: {
    airtableSearch: {
      searchAirtableHumans: FunctionReference<
        "action",
        "public",
        { key: string; query: string },
        any
      >;
    };
    crm: {
      addChatTag: FunctionReference<
        "mutation",
        "public",
        { chatGuid: string; key: string; tag: string },
        any
      >;
      addTag: FunctionReference<
        "mutation",
        "public",
        { key: string; personId: Id<"people">; tag: string },
        any
      >;
      removeChatTag: FunctionReference<
        "mutation",
        "public",
        { chatGuid: string; key: string; tag: string },
        any
      >;
      removeTag: FunctionReference<
        "mutation",
        "public",
        { key: string; personId: Id<"people">; tag: string },
        any
      >;
      setChatFavorite: FunctionReference<
        "mutation",
        "public",
        { chatGuid: string; is_favorite: boolean; key: string },
        any
      >;
      setChatPriority: FunctionReference<
        "mutation",
        "public",
        { chatGuid: string; key: string; priority?: number | null },
        any
      >;
      setFavorite: FunctionReference<
        "mutation",
        "public",
        { is_favorite: boolean; key: string; personId: Id<"people"> },
        any
      >;
      setPriority: FunctionReference<
        "mutation",
        "public",
        { key: string; personId: Id<"people">; priority?: number | null },
        any
      >;
    };
    events: {
      linkEvent: FunctionReference<
        "mutation",
        "public",
        {
          airtable_event_id: string;
          chatGuid?: string;
          event_name: string;
          key: string;
          personId?: Id<"people">;
        },
        any
      >;
      searchEvents: FunctionReference<
        "action",
        "public",
        { key: string; query: string },
        any
      >;
      unlinkEvent: FunctionReference<
        "mutation",
        "public",
        { key: string; linkId: Id<"event_links"> },
        any
      >;
    };
    mutations: {
      addPersonFromAirtable: FunctionReference<
        "mutation",
        "public",
        {
          display_name?: string;
          email?: string;
          first_name?: string;
          key: string;
          last_name?: string;
          phone?: string;
          record_id: string;
        },
        any
      >;
      createPerson: FunctionReference<
        "mutation",
        "public",
        {
          display_name?: string;
          first_name?: string;
          handle: string;
          key: string;
          last_name?: string;
          nickname?: string;
          organization?: string;
        },
        any
      >;
      renamePerson: FunctionReference<
        "mutation",
        "public",
        {
          display_name?: string;
          first_name?: string;
          key: string;
          last_name?: string;
          nickname?: string;
          organization?: string;
          personId: Id<"people">;
        },
        any
      >;
    };
    queries: {
      chatCrm: FunctionReference<
        "query",
        "public",
        { chatGuids?: Array<string>; key: string },
        any
      >;
      listPeople: FunctionReference<"query", "public", { key: string }, any>;
      listTags: FunctionReference<"query", "public", { key: string }, any>;
      nameDirectory: FunctionReference<"query", "public", { key: string }, any>;
      searchPeople: FunctionReference<
        "query",
        "public",
        { key: string; name: string },
        any
      >;
      topLinkedPeople: FunctionReference<
        "query",
        "public",
        { key: string; limit?: number },
        any
      >;
      whoIs: FunctionReference<
        "query",
        "public",
        { handle: string; key: string },
        any
      >;
    };
  };
  routines: {
    actions: {
      clearAllPendingRoutineTasks: {
        clearAllPendingRoutineTasks: FunctionReference<
          "action",
          "public",
          {},
          any
        >;
      };
      skipRoutineTask: {
        skipRoutineTask: FunctionReference<
          "action",
          "public",
          { routineTaskId: Id<"routineTasks"> },
          any
        >;
      };
    };
    queries: {
      getPendingRoutineTasks: {
        getPendingRoutineTasks: FunctionReference<"query", "public", {}, any>;
      };
      getRoutineGenerationStatus: {
        getRoutineGenerationStatus: FunctionReference<
          "query",
          "public",
          {},
          any
        >;
      };
      getRoutines: {
        getRoutines: FunctionReference<
          "query",
          "public",
          { deferFilter?: "active" | "deferred" | "all" },
          any
        >;
      };
      getRoutinesByProject: {
        getRoutinesByProject: FunctionReference<
          "query",
          "public",
          { includeDeferred?: boolean; projectId: string },
          any
        >;
      };
      getRoutinesByView: {
        getRoutinesByView: FunctionReference<
          "query",
          "public",
          { list: { type: "routines"; view: string } },
          any
        >;
      };
      getRoutineStats: {
        getRoutineStats: FunctionReference<
          "query",
          "public",
          { routineId: Id<"routines"> },
          any
        >;
      };
      getRoutineTaskByTodoistId: {
        getRoutineTaskByTodoistIdPublic: FunctionReference<
          "query",
          "public",
          { todoistTaskId: string },
          any
        >;
      };
      getRoutineTasks: {
        getRoutineTasks: FunctionReference<
          "query",
          "public",
          {
            routineId: Id<"routines">;
            statusFilter?:
              | "pending"
              | "completed"
              | "missed"
              | "skipped"
              | "deferred"
              | "all";
          },
          any
        >;
      };
    };
  };
  todoist: {
    actions: {
      archiveProject: {
        archiveProject: FunctionReference<
          "action",
          "public",
          { projectId: string },
          any
        >;
      };
      clearAllData: {
        clearAllData: FunctionReference<"action", "public", {}, any>;
      };
      completeMultipleTasks: {
        completeMultipleTasks: FunctionReference<
          "action",
          "public",
          { todoistIds: Array<string> },
          any
        >;
      };
      completeTask: {
        completeTask: FunctionReference<
          "action",
          "public",
          { todoistId: string },
          any
        >;
      };
      createComment: {
        createComment: FunctionReference<
          "action",
          "public",
          {
            attachment?: {
              fileName?: string;
              fileType?: string;
              fileUrl: string;
              resourceType?: string;
            };
            content: string;
            projectId?: string;
            taskId?: string;
          },
          any
        >;
      };
      createLabel: {
        createLabel: FunctionReference<
          "action",
          "public",
          {
            color?: string;
            isFavorite?: boolean;
            name: string;
            order?: number;
          },
          any
        >;
      };
      createProject: {
        createProject: FunctionReference<
          "action",
          "public",
          {
            color?: string;
            isFavorite?: boolean;
            name: string;
            parentId?: string;
            viewStyle?: "list" | "board" | "calendar";
          },
          any
        >;
      };
      createSection: {
        createSection: FunctionReference<
          "action",
          "public",
          { name: string; order?: number; projectId: string },
          any
        >;
      };
      createTask: {
        createTask: FunctionReference<
          "action",
          "public",
          {
            content: string;
            deadlineDate?: string;
            deadlineLang?: string;
            description?: string;
            due?: {
              date: string;
              datetime?: string;
              string?: string;
              timezone?: string;
            };
            labels?: Array<string>;
            priority?: number;
            projectId?: string;
            sectionId?: string;
          },
          any
        >;
      };
      deleteComment: {
        deleteComment: FunctionReference<
          "action",
          "public",
          { commentId: string },
          any
        >;
      };
      deleteLabel: {
        deleteLabel: FunctionReference<
          "action",
          "public",
          { labelId: string },
          any
        >;
      };
      deleteProject: {
        deleteProject: FunctionReference<
          "action",
          "public",
          { projectId: string },
          any
        >;
      };
      deleteSection: {
        deleteSection: FunctionReference<
          "action",
          "public",
          { sectionId: string },
          any
        >;
      };
      deleteTask: {
        deleteTask: FunctionReference<
          "action",
          "public",
          { taskId: string },
          any
        >;
      };
      duplicateTask: {
        duplicateTask: FunctionReference<
          "action",
          "public",
          {
            options?: {
              newContent?: string;
              parentId?: string;
              projectId?: string;
              sectionId?: string;
            };
            taskId: string;
          },
          any
        >;
      };
      ensureProjectMetadata: {
        ensureAllProjectsHaveMetadata: FunctionReference<
          "action",
          "public",
          {},
          any
        >;
        ensureProjectHasMetadata: FunctionReference<
          "action",
          "public",
          { projectId: string },
          any
        >;
      };
      ensureProjectMetadataTask: {
        ensureProjectMetadataTask: FunctionReference<
          "action",
          "public",
          { projectId: string },
          any
        >;
      };
      moveProject: {
        moveProject: FunctionReference<
          "action",
          "public",
          { childOrder: number; parentId?: string | null; projectId: string },
          any
        >;
      };
      moveTask: {
        moveTask: FunctionReference<
          "action",
          "public",
          {
            parentId?: string;
            projectId?: string;
            sectionId?: string;
            todoistId: string;
          },
          any
        >;
      };
      performIncrementalSync: {
        performIncrementalSync: FunctionReference<"action", "public", {}, any>;
      };
      refreshProjectMetadata: {
        refreshProjectMetadata: FunctionReference<
          "action",
          "public",
          { projectId?: string },
          any
        >;
      };
      reopenTask: {
        reopenTask: FunctionReference<
          "action",
          "public",
          { todoistId: string },
          any
        >;
      };
      startQueueSession: {
        startQueueSession: FunctionReference<
          "action",
          "public",
          {
            queueOptions?: {
              context?: string;
              context_type?: string;
              max_tasks?: number;
              timeframe?: string;
            };
            queueType: "priority" | "focused" | "context";
          },
          any
        >;
      };
      unarchiveProject: {
        unarchiveProject: FunctionReference<
          "action",
          "public",
          { projectId: string },
          any
        >;
      };
      updateComment: {
        updateComment: FunctionReference<
          "action",
          "public",
          { commentId: string; content: string },
          any
        >;
      };
      updateLabel: {
        updateLabel: FunctionReference<
          "action",
          "public",
          {
            color?: string;
            isFavorite?: boolean;
            labelId: string;
            name?: string;
            order?: number;
          },
          any
        >;
      };
      updateProject: {
        updateProject: FunctionReference<
          "action",
          "public",
          {
            color?: string;
            isFavorite?: boolean;
            name?: string;
            projectId: string;
            viewStyle?: "list" | "board" | "calendar";
          },
          any
        >;
      };
      updateProjectMetadata: {
        batchUpdateProjectMetadata: FunctionReference<
          "action",
          "public",
          {
            updates: Array<{
              description?: string;
              priority?: 1 | 2 | 3 | 4;
              projectId: string;
              projectType?: "area-of-responsibility" | "project-type";
              scheduledDate?: string;
            }>;
          },
          any
        >;
        resetProjectMetadata: FunctionReference<
          "action",
          "public",
          { projectId: string },
          any
        >;
        updateProjectMetadata: FunctionReference<
          "action",
          "public",
          {
            description?: string;
            priority?: 1 | 2 | 3 | 4;
            projectId: string;
            projectType?: "area-of-responsibility" | "project-type";
            scheduledDate?: string;
          },
          any
        >;
      };
      updateProjectMetadataDescription: {
        updateProjectMetadataDescription: FunctionReference<
          "action",
          "public",
          { description: string; projectId: string },
          any
        >;
      };
      updateProjectMetadataPriority: {
        updateProjectMetadataPriority: FunctionReference<
          "action",
          "public",
          { priority: 1 | 2 | 3 | 4; projectId: string },
          any
        >;
      };
      updateProjectName: {
        updateProjectName: FunctionReference<
          "action",
          "public",
          { name: string; projectId: string },
          any
        >;
      };
      updateProjectType: {
        updateProjectType: FunctionReference<
          "action",
          "public",
          {
            projectId: string;
            projectType: "area-of-responsibility" | "project-type" | null;
          },
          any
        >;
      };
      updateSection: {
        updateSection: FunctionReference<
          "action",
          "public",
          { name: string; sectionId: string },
          any
        >;
      };
      updateTask: {
        updateTask: FunctionReference<
          "action",
          "public",
          {
            content?: string;
            deadlineDate?: string | null;
            deadlineLang?: string | null;
            description?: string;
            dueDate?: string;
            dueDatetime?: string;
            dueString?: string;
            labels?: Array<string>;
            priority?: number;
            todoistId: string;
          },
          any
        >;
      };
    };
    computed: {
      queries: {
        getAllListCounts: {
          getAllListCounts: FunctionReference<
            "query",
            "public",
            { timezoneOffsetMinutes?: number },
            any
          >;
        };
        getProjectsByPriority: {
          getProjectsByPriority: FunctionReference<
            "query",
            "public",
            { includeStats?: boolean; priority: number },
            any
          >;
        };
        getProjectsWithMetadata: {
          getProjectsWithMetadata: FunctionReference<
            "query",
            "public",
            { includeDeleted?: boolean },
            any
          >;
        };
        getScheduledProjects: {
          getScheduledProjects: FunctionReference<
            "query",
            "public",
            { from?: string; to?: string },
            any
          >;
        };
      };
    };
    debug: {
      getCompletedItems: FunctionReference<"query", "public", {}, any>;
      getDeletedItems: FunctionReference<"query", "public", {}, any>;
      getDeletedLabels: FunctionReference<"query", "public", {}, any>;
      getItemByTodoistId: FunctionReference<
        "query",
        "public",
        { todoistId: string },
        any
      >;
      getItemStats: FunctionReference<"query", "public", {}, any>;
      getLabelByName: FunctionReference<
        "query",
        "public",
        { name: string },
        any
      >;
      getProjectByName: FunctionReference<
        "query",
        "public",
        { name: string },
        any
      >;
      getRawSyncData: FunctionReference<"query", "public", {}, any>;
      getRecentlyModifiedItems: FunctionReference<"query", "public", {}, any>;
      getSectionByName: FunctionReference<
        "query",
        "public",
        { name: string },
        any
      >;
      searchItemByContent: FunctionReference<
        "query",
        "public",
        { searchTerm: string },
        any
      >;
    };
    queries: {
      getActiveItems: {
        getActiveItems: FunctionReference<
          "query",
          "public",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            combineDueAndDeadline?: boolean;
            includeDeadlines?: boolean;
            limit?: number;
            projectId?: string;
            timeFilter?:
              | "overdue"
              | "today"
              | "tomorrow"
              | "next7days"
              | "future"
              | "none"
              | "all";
          },
          any
        >;
      };
      getAllProjects: {
        getAllProjects: FunctionReference<
          "query",
          "public",
          { limit?: number },
          any
        >;
      };
      getContextBatch: {
        getContextBatch: FunctionReference<
          "query",
          "public",
          {
            context_type:
              | "calls"
              | "emails"
              | "errands"
              | "admin"
              | "creative"
              | "development"
              | "all";
            include_low_priority?: boolean;
            max_tasks?: number;
          },
          any
        >;
      };
      getDueFutureItems: {
        getDueFutureItems: FunctionReference<
          "query",
          "public",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            limit?: number;
            projectId?: string;
          },
          any
        >;
      };
      getDueNext7DaysItems: {
        getDueNext7DaysItems: FunctionReference<
          "query",
          "public",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            limit?: number;
            projectId?: string;
            timezoneOffsetMinutes?: number;
          },
          any
        >;
      };
      getDueTodayItems: {
        getDueTodayItems: FunctionReference<
          "query",
          "public",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            limit?: number;
            projectId?: string;
            timezoneOffsetMinutes?: number;
          },
          any
        >;
      };
      getDueTomorrowItems: {
        getDueTomorrowItems: FunctionReference<
          "query",
          "public",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            limit?: number;
            projectId?: string;
          },
          any
        >;
      };
      getFocusedTasks: {
        getFocusedTasks: FunctionReference<
          "query",
          "public",
          {
            context?: "work" | "personal" | "errands" | "all";
            include_assigned_to_others?: boolean;
            limit?: number;
            timeframe?: "today" | "week" | "overdue" | "all";
          },
          any
        >;
      };
      getItemByTodoistIdPublic: {
        default: FunctionReference<
          "query",
          "public",
          { todoistId: string },
          any
        >;
      };
      getItemsByView: {
        getItemsByView: FunctionReference<
          "query",
          "public",
          {
            list:
              | {
                  inboxProjectId?: string;
                  timezoneOffsetMinutes?: number;
                  type: "inbox";
                  view: string;
                }
              | {
                  range: "overdue" | "today" | "upcoming" | "no-date";
                  timezoneOffsetMinutes?: number;
                  type: "time";
                  view: string;
                }
              | {
                  projectId: string;
                  timezoneOffsetMinutes?: number;
                  type: "project";
                  view: string;
                }
              | {
                  priority: 1 | 2 | 3 | 4;
                  timezoneOffsetMinutes?: number;
                  type: "priority";
                  view: string;
                }
              | {
                  label: string;
                  timezoneOffsetMinutes?: number;
                  type: "label";
                  view: string;
                };
          },
          any
        >;
      };
      getItemsByViewWithProjects: {
        getItemsByViewWithProjects: FunctionReference<
          "query",
          "public",
          {
            list:
              | {
                  inboxProjectId?: string;
                  timezoneOffsetMinutes?: number;
                  type: "inbox";
                  view: string;
                }
              | {
                  range: "overdue" | "today" | "upcoming" | "no-date";
                  timezoneOffsetMinutes?: number;
                  type: "time";
                  view: string;
                }
              | {
                  projectId: string;
                  timezoneOffsetMinutes?: number;
                  type: "project";
                  view: string;
                }
              | {
                  priority: 1 | 2 | 3 | 4;
                  timezoneOffsetMinutes?: number;
                  type: "priority";
                  view: string;
                }
              | {
                  label: string;
                  timezoneOffsetMinutes?: number;
                  type: "label";
                  view: string;
                }
              | {
                  filter:
                    | "overdue"
                    | "morning"
                    | "night"
                    | "todays"
                    | "get-ahead";
                  timezoneOffsetMinutes?: number;
                  type: "routine-tasks";
                  view: string;
                }
              | {
                  timezoneOffsetMinutes?: number;
                  type: "agent-queue";
                  view: string;
                };
          },
          any
        >;
      };
      getLabelFilterCounts: {
        getLabelFilterCounts: FunctionReference<"query", "public", {}, any>;
      };
      getLabels: {
        getLabels: FunctionReference<"query", "public", {}, any>;
      };
      getNoDueDateItems: {
        getNoDueDateItems: FunctionReference<
          "query",
          "public",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            limit?: number;
            projectId?: string;
          },
          any
        >;
      };
      getOverdueItems: {
        getOverdueItems: FunctionReference<
          "query",
          "public",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            limit?: number;
            projectId?: string;
          },
          any
        >;
      };
      getPriorityFilterCounts: {
        getPriorityFilterCounts: FunctionReference<"query", "public", {}, any>;
      };
      getPriorityQueue: {
        getPriorityQueue: FunctionReference<
          "query",
          "public",
          {
            include_assigned_to_others?: boolean;
            max_tasks?: number;
            target_hours?: number;
          },
          any
        >;
      };
      getProject: {
        getProject: FunctionReference<
          "query",
          "public",
          { projectId: string },
          any
        >;
      };
      getProjectMetadata: {
        getProjectMetadata: FunctionReference<
          "query",
          "public",
          { projectId: string },
          any
        >;
      };
      getProjects: {
        getProjectByTodoistId: FunctionReference<
          "query",
          "public",
          { todoistId: string },
          any
        >;
        getProjects: FunctionReference<"query", "public", {}, any>;
      };
      getProjectsByPriority: {
        getProjectsByPriority: FunctionReference<
          "query",
          "public",
          { priorityLevel: number },
          any
        >;
      };
      getProjectTaskCounts: {
        getProjectTaskCounts: FunctionReference<"query", "public", {}, any>;
      };
      getProjectWithItemCount: {
        getProjectWithItemCount: FunctionReference<
          "query",
          "public",
          { projectId: string },
          any
        >;
      };
      getQueueState: {
        getQueueState: FunctionReference<
          "query",
          "public",
          { queueId: string },
          any
        >;
      };
      getSyncStatus: {
        getSyncStatus: FunctionReference<"query", "public", {}, any>;
      };
      getTimeFilterCounts: {
        getTimeFilterCounts: FunctionReference<
          "query",
          "public",
          { timezoneOffsetMinutes?: number },
          any
        >;
      };
    };
  };
};

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: {
  agentic: {
    mutations: {
      _adminDeleteByEntityRef: {
        default: FunctionReference<
          "mutation",
          "internal",
          { entity_ref: string },
          any
        >;
      };
      _adminDeleteByRunId: {
        default: FunctionReference<
          "mutation",
          "internal",
          { run_id: string },
          any
        >;
      };
      _adminSetUrgency: {
        default: FunctionReference<
          "mutation",
          "internal",
          { entity_ref: string; urgency: number | null },
          any
        >;
      };
    };
    queries: {
      _adminDigest: {
        default: FunctionReference<"query", "internal", {}, any>;
      };
      _adminGetThread: {
        default: FunctionReference<
          "query",
          "internal",
          { entity_ref: string },
          any
        >;
      };
      _adminListAll: {
        default: FunctionReference<"query", "internal", {}, any>;
      };
      _adminOpenProposals: {
        default: FunctionReference<"query", "internal", {}, any>;
      };
    };
  };
  auth: {
    _getUserEmail: FunctionReference<
      "query",
      "internal",
      { userId: Id<"users"> },
      any
    >;
    store: FunctionReference<
      "mutation",
      "internal",
      {
        args:
          | {
              generateTokens: boolean;
              sessionId?: Id<"authSessions">;
              type: "signIn";
              userId: Id<"users">;
            }
          | { type: "signOut" }
          | { refreshToken: string; type: "refreshSession" }
          | {
              allowExtraProviders: boolean;
              generateTokens: boolean;
              params: any;
              provider?: string;
              type: "verifyCodeAndSignIn";
              verifier?: string;
            }
          | { type: "verifier" }
          | { signature: string; type: "verifierSignature"; verifier: string }
          | {
              profile: any;
              provider: string;
              providerAccountId: string;
              signature: string;
              type: "userOAuth";
            }
          | {
              accountId?: Id<"authAccounts">;
              allowExtraProviders: boolean;
              code: string;
              email?: string;
              expirationTime: number;
              phone?: string;
              provider: string;
              type: "createVerificationCode";
            }
          | {
              account: { id: string; secret?: string };
              profile: any;
              provider: string;
              shouldLinkViaEmail?: boolean;
              shouldLinkViaPhone?: boolean;
              type: "createAccountFromCredentials";
            }
          | {
              account: { id: string; secret?: string };
              provider: string;
              type: "retrieveAccountWithCredentials";
            }
          | {
              account: { id: string; secret: string };
              provider: string;
              type: "modifyAccount";
            }
          | {
              except?: Array<Id<"authSessions">>;
              type: "invalidateSessions";
              userId: Id<"users">;
            };
      },
      any
    >;
  };
  beeper: {
    internalMutations: {
      generateUploadUrl: {
        generateUploadUrl: FunctionReference<"mutation", "internal", any, any>;
      };
      markAccountSynced: {
        markAccountSynced: FunctionReference<
          "mutation",
          "internal",
          { account_id: string; sync_type: "full" | "incremental" },
          any
        >;
      };
      recordAttachment: {
        recordAttachment: FunctionReference<
          "mutation",
          "internal",
          {
            convex_storage_id: string;
            duration_ms?: number;
            file_name?: string;
            file_size?: number;
            height?: number;
            mime_type?: string;
            mxc_id: string;
            network: string;
            width?: number;
          },
          any
        >;
      };
      upsertAccount: {
        upsertAccount: FunctionReference<
          "mutation",
          "internal",
          {
            account: {
              account_id: string;
              display_name?: string;
              is_active?: boolean;
              network: string;
              phone_number?: string;
              raw?: string;
            };
            mark_full_sync_started?: boolean;
          },
          any
        >;
      };
      upsertChat: {
        upsertChat: FunctionReference<
          "mutation",
          "internal",
          {
            chat: {
              account_id: string;
              chat_id: string;
              description?: string;
              img_url?: string;
              is_archived?: boolean;
              is_muted?: boolean;
              is_pinned?: boolean;
              is_read_only?: boolean;
              last_activity?: string;
              local_chat_id?: string;
              network: string;
              participants: Array<{
                full_name?: string;
                id: string;
                img_url?: string;
                is_admin?: boolean;
                is_self?: boolean;
                phone_number?: string;
              }>;
              raw?: string;
              title?: string;
              type: string;
              unread_count?: number;
            };
          },
          any
        >;
      };
      upsertMessages: {
        upsertMessages: FunctionReference<
          "mutation",
          "internal",
          {
            chat_id: string;
            messages: Array<{
              account_id: string;
              attachments?: Array<{
                beeper_src_url?: string;
                convex_storage_id?: string;
                duration_ms?: number;
                file_name?: string;
                file_size?: number;
                height?: number;
                is_gif?: boolean;
                is_sticker?: boolean;
                mime_type?: string;
                mxc_id: string;
                type?: string;
                width?: number;
              }>;
              chat_id: string;
              is_deleted?: boolean;
              is_hidden?: boolean;
              is_sender?: boolean;
              message_id: string;
              network: string;
              raw?: string;
              reactions?: Array<{
                emoji_or_key: string;
                participant_id: string;
              }>;
              reply_to_message_id?: string;
              sender_id?: string;
              sender_name?: string;
              sort_key?: string;
              text?: string;
              timestamp?: string;
              type?: string;
            }>;
          },
          any
        >;
      };
    };
    queries: {
      discoverAttachments: {
        discoverAttachments: FunctionReference<
          "query",
          "internal",
          { mxc_ids: Array<string> },
          any
        >;
      };
    };
  };
  comma: {
    ingest: {
      generateUploadUrl: FunctionReference<"mutation", "internal", {}, any>;
    };
    internal: {
      importOverlay: FunctionReference<
        "mutation",
        "internal",
        {
          chatState: Array<{
            chatGuid: string;
            dismissedUnrespondedGuid?: string;
            dismissedWaitingGuid?: string;
            markedUnread: boolean;
            mutedUnresponded: boolean;
            pinned: boolean;
            readAt: number;
          }>;
          replaceChatGuids?: Array<string>;
          triageEvents: Array<{
            chatGuid: string;
            clearedAt: number;
            messageGuid: string;
            reason: "reply" | "dismiss";
          }>;
          triageOpen: Array<{
            chatGuid: string;
            messageGuid: string;
            openedAt: number;
          }>;
        },
        { events: number; open: number; states: number; unresolved: number }
      >;
      markSyncState: FunctionReference<
        "mutation",
        "internal",
        {
          counts?: Record<string, number>;
          cursor?: string;
          key: string;
          lastEventAt?: number;
          lastReconcileAt?: number;
        },
        null
      >;
      mediaBacklog: FunctionReference<
        "mutation",
        "internal",
        { cursor: string | null; limit: number },
        {
          cursor: string;
          isDone: boolean;
          items: Array<{
            createdAt: number;
            filename?: string;
            guid: string;
            mimeType?: string;
            needsOriginal: boolean;
            needsThumb: boolean;
          }>;
        }
      >;
      mergeDuplicateConversations: FunctionReference<
        "mutation",
        "internal",
        { dryRun: boolean },
        Array<{
          kept: Id<"comma_conversations">;
          key: string;
          removed: Id<"comma_conversations">;
        }>
      >;
      replaceScheduled: FunctionReference<
        "mutation",
        "internal",
        {
          items: Array<{
            bbId: number;
            chatGuid: string;
            error?: string;
            sendAt: number;
            sentAt?: number;
            status:
              | "pending"
              | "in-progress"
              | "complete"
              | "failed"
              | "interrupted"
              | "expired";
            text: string;
          }>;
        },
        { deleted: number; upserted: number }
      >;
      setAttachmentStorage: FunctionReference<
        "mutation",
        "internal",
        {
          guid: string;
          originalStorageId?: Id<"_storage">;
          thumbStorageId?: Id<"_storage">;
        },
        boolean
      >;
      setSuggestions: FunctionReference<
        "mutation",
        "internal",
        {
          anchorGuid: string;
          conversationId: Id<"comma_conversations">;
          payload: {
            event: {
              durationMinutes: number;
              inviteEmails: Array<string>;
              location: string | null;
              start: string;
              title: string;
            } | null;
            fallback: boolean;
            noReply: boolean;
            recipeVersion: number;
            selectedModel: "opus" | "terra";
            servedModel: "opus" | "terra";
            suggestions: Array<{
              id: string;
              kind: "text" | "reaction";
              reaction: string | null;
              strategy: string;
              targetMessageGuid: string | null;
              targetMessagePreview: string | null;
              targetPartIndex: number | null;
              text: string;
              vibe: string;
            }>;
          };
        },
        null
      >;
      setTranscript: FunctionReference<
        "mutation",
        "internal",
        { attachmentGuid: string; transcript: string },
        boolean
      >;
      upsertAttachments: FunctionReference<
        "mutation",
        "internal",
        {
          attachments: Array<{
            conversationId: Id<"comma_conversations">;
            filename?: string;
            guid: string;
            height?: number;
            hideAttachment: boolean;
            isOnDisk: boolean;
            isSticker: boolean;
            messageGuid: string;
            mimeType?: string;
            originalStorageId?: Id<"_storage">;
            sourceVersion: number;
            thumbStorageId?: Id<"_storage">;
            totalBytes?: number;
            transcript?: string;
            transferName?: string;
            transferState?: number;
            uti?: string;
            width?: number;
          }>;
        },
        { skipped: number; written: number }
      >;
      upsertConversations: FunctionReference<
        "mutation",
        "internal",
        {
          conversations: Array<{
            chats: Array<{ chatGuid: string; lastMessageAt: number }>;
            conversationKey: string;
            displayName: string;
            hasGroupPhoto: boolean;
            isGroup: boolean;
            isSpam: boolean;
            lastMessage?: {
              dateCreated: number;
              guid: string;
              hasAttachments: boolean;
              isFromMe: boolean;
              senderName: string | null;
              text: string;
            };
            lastMessageAt: number;
            participants: Array<{ address: string; name: string | null }>;
          }>;
        },
        Record<string, Id<"comma_conversations">>
      >;
      upsertMessages: FunctionReference<
        "mutation",
        "internal",
        {
          messages: Array<{
            attachmentGuids: Array<string>;
            chatGuid: string;
            clientKey?: string;
            conversationId: Id<"comma_conversations">;
            dateCreated: number;
            dateDelivered?: number;
            dateEdited?: number;
            dateRead?: number;
            dateRetracted?: number;
            edited: boolean;
            error: number;
            guid: string;
            isFromMe: boolean;
            isGroupEvent: boolean;
            isSpam?: boolean;
            isTapback: boolean;
            mentions: Array<{ address: string; length: number; start: number }>;
            reactions: Array<{
              emoji?: string;
              isFromMe: boolean;
              senderAddress: string | null;
              senderName: string | null;
              type: string;
            }>;
            replyToFromMe?: boolean;
            replyToGuid?: string;
            replyToPreview?: string;
            retracted: boolean;
            sendEffect?: string;
            sender?: { address: string; name: string | null };
            service: "iMessage" | "SMS";
            sourceVersion: number;
            special?:
              | { kind: "contact"; name: string | null }
              | { kind: "location" }
              | { kind: "apple-cash" }
              | { kind: "poll" }
              | { kind: "unknown"; label: string };
            tapback?: {
              emoji?: string;
              reaction: string;
              remove: boolean;
              targetGuid: string;
            };
            tapbackTargetGuid?: string;
            text: string;
          }>;
        },
        { skipped: number; written: number }
      >;
    };
    outbox: {
      claimOutbox: FunctionReference<
        "mutation",
        "internal",
        { leaseMs: number; limit: number; now: number },
        Array<{
          _creationTime: number;
          _id: Id<"comma_outbox">;
          attempts: number;
          clientKey: string;
          conversationId: Id<"comma_conversations">;
          createdAt: number;
          error?: string;
          leaseUntil?: number;
          payload:
            | {
                kind: "send";
                mentions?: Array<{
                  address: string;
                  length: number;
                  start: number;
                }>;
                replyToGuid?: string;
                replyToPart?: number;
                text: string;
              }
            | {
                kind: "react";
                messageGuid: string;
                partIndex?: number;
                reaction: string;
                remove: boolean;
              }
            | {
                kind: "edit";
                messageGuid: string;
                partIndex?: number;
                text: string;
              }
            | { kind: "unsend"; messageGuid: string; partIndex?: number }
            | { kind: "delete"; messageGuid: string; partIndex?: number }
            | { kind: "markRead"; messageGuid?: string }
            | { kind: "markUnread"; messageGuid?: string }
            | { kind: "settle"; messageGuid?: string }
            | { kind: "unsettle"; messageGuid?: string }
            | { kind: "pin"; value: boolean }
            | { kind: "mute"; value: boolean }
            | { kind: "rename"; name: string }
            | { kind: "schedule"; sendAt: number; text: string }
            | {
                bbId: number;
                kind: "editScheduled";
                sendAt: number;
                text: string;
              }
            | { bbId: number; kind: "cancelScheduled" };
          resultGuid?: string;
          status: "pending" | "claimed" | "sent" | "failed" | "unknown";
          updatedAt: number;
        }>
      >;
      completeOutbox: FunctionReference<
        "mutation",
        "internal",
        {
          clientKey: string;
          error?: string;
          resultGuid?: string;
          status: "sent" | "failed" | "unknown";
        },
        boolean
      >;
    };
    photos: {
      setContactPhoto: FunctionReference<
        "mutation",
        "internal",
        { address: string; hash: string; storageId: Id<"_storage"> },
        boolean
      >;
    };
  };
  identity: {
    admin: {
      deletePersonByHandle: FunctionReference<
        "mutation",
        "internal",
        { handle: string },
        any
      >;
      migratePersonTags: FunctionReference<"mutation", "internal", {}, any>;
      migratePriorityToNumeric: FunctionReference<
        "mutation",
        "internal",
        {},
        any
      >;
      rederiveLockedStructuredNames: FunctionReference<
        "mutation",
        "internal",
        {},
        any
      >;
    };
    airtableSync: {
      syncAirtableHumans: FunctionReference<"action", "internal", {}, any>;
    };
    ingestContacts: {
      ingestContactsBatch: FunctionReference<
        "mutation",
        "internal",
        {
          contacts: Array<{
            airtable_record_id?: string;
            display_name?: string;
            emails: Array<string>;
            first_name?: string;
            last_name?: string;
            nickname?: string;
            phones: Array<string>;
            source_contact_id?: string;
          }>;
          link_only?: boolean;
          source: string;
        },
        any
      >;
    };
    internal: {
      assignCluster: FunctionReference<
        "mutation",
        "internal",
        { identityIds: Array<Id<"identities">> },
        any
      >;
      listChatsPage: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; numItems: number },
        any
      >;
      listIdentitiesPage: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; numItems: number },
        any
      >;
      stats: FunctionReference<"query", "internal", {}, any>;
      upsertIdentitiesBatch: FunctionReference<
        "mutation",
        "internal",
        {
          items: Array<{
            chat_count: number;
            display_name?: string;
            img_url?: string;
            is_self: boolean;
            kind: string;
            last_seen_at?: string;
            network?: string;
            normalized: string;
            phone_number?: string;
            source: string;
            value: string;
          }>;
        },
        any
      >;
    };
    resolve: {
      resolveIdentities: FunctionReference<"action", "internal", {}, any>;
    };
  };
  routines: {
    crons: {
      dailyRoutineGeneration: FunctionReference<"action", "internal", any, any>;
    };
    internalActions: {
      createRoutineTaskInTodoist: {
        createRoutineTaskInTodoist: FunctionReference<
          "action",
          "internal",
          { routineTaskId: Id<"routineTasks"> },
          any
        >;
      };
      generateAndCreateRoutineTasks: {
        generateAndCreateRoutineTasks: FunctionReference<
          "action",
          "internal",
          { routineId: Id<"routines"> },
          any
        >;
      };
      generateDailyRoutineTasks: {
        generateDailyRoutineTasks: FunctionReference<
          "action",
          "internal",
          any,
          any
        >;
      };
      manuallyGenerateRoutineTasks: {
        manuallyGenerateRoutineTasks: FunctionReference<
          "action",
          "internal",
          any,
          any
        >;
      };
    };
    internalMutations: {
      createRoutine: {
        createRoutine: FunctionReference<
          "mutation",
          "internal",
          {
            category?: string;
            description?: string;
            duration:
              | "5min"
              | "15min"
              | "30min"
              | "45min"
              | "1hr"
              | "2hr"
              | "3hr"
              | "4hr";
            frequency:
              | "Daily"
              | "Twice a Week"
              | "Weekly"
              | "Every Other Week"
              | "Monthly"
              | "Every Other Month"
              | "Quarterly"
              | "Twice a Year"
              | "Yearly"
              | "Every Other Year";
            idealDay?: number;
            name: string;
            priority?: number;
            timeOfDay?: "Morning" | "Day" | "Evening" | "Night";
            todoistLabels?: Array<string>;
            todoistProjectId?: string;
          },
          any
        >;
      };
      deferRoutine: {
        deferRoutine: FunctionReference<
          "mutation",
          "internal",
          { routineId: Id<"routines"> },
          any
        >;
      };
      deleteRoutine: {
        deleteRoutine: FunctionReference<
          "mutation",
          "internal",
          { routineId: Id<"routines"> },
          any
        >;
      };
      deleteRoutineTask: {
        deleteRoutineTask: FunctionReference<
          "mutation",
          "internal",
          { routineTaskId: Id<"routineTasks"> },
          any
        >;
      };
      generateTasksForRoutine: {
        generateTasksForRoutine: FunctionReference<
          "mutation",
          "internal",
          { routineId: Id<"routines"> },
          any
        >;
      };
      handleDeferredRoutines: {
        handleDeferredRoutines: FunctionReference<
          "mutation",
          "internal",
          {},
          any
        >;
      };
      linkRoutineTask: {
        linkRoutineTask: FunctionReference<
          "mutation",
          "internal",
          { routineTaskId: Id<"routineTasks">; todoistTaskId: string },
          any
        >;
      };
      markRoutineTaskCompleted: {
        markRoutineTaskCompleted: FunctionReference<
          "mutation",
          "internal",
          { completedDate: number; routineTaskId: Id<"routineTasks"> },
          any
        >;
      };
      markRoutineTaskPending: {
        markRoutineTaskPending: FunctionReference<
          "mutation",
          "internal",
          { routineTaskId: Id<"routineTasks"> },
          any
        >;
      };
      markRoutineTaskSkipped: {
        markRoutineTaskSkipped: FunctionReference<
          "mutation",
          "internal",
          { routineTaskId: Id<"routineTasks"> },
          any
        >;
      };
      recalculateRoutineCompletionRate: {
        recalculateRoutineCompletionRate: FunctionReference<
          "mutation",
          "internal",
          { routineId: Id<"routines"> },
          any
        >;
      };
      undeferRoutine: {
        undeferRoutine: FunctionReference<
          "mutation",
          "internal",
          { routineId: Id<"routines"> },
          any
        >;
      };
      updateOverdueRoutineTasks: {
        updateOverdueRoutineTasks: FunctionReference<
          "mutation",
          "internal",
          {},
          any
        >;
      };
      updateRoutine: {
        updateRoutine: FunctionReference<
          "mutation",
          "internal",
          {
            category?: string;
            description?: string;
            duration?:
              | "5min"
              | "15min"
              | "30min"
              | "45min"
              | "1hr"
              | "2hr"
              | "3hr"
              | "4hr";
            frequency?:
              | "Daily"
              | "Twice a Week"
              | "Weekly"
              | "Every Other Week"
              | "Monthly"
              | "Every Other Month"
              | "Quarterly"
              | "Twice a Year"
              | "Yearly"
              | "Every Other Year";
            idealDay?: null | number;
            name?: string;
            priority?: number;
            routineId: Id<"routines">;
            timeOfDay?: null | "Morning" | "Day" | "Evening" | "Night";
            todoistLabels?: Array<string>;
            todoistProjectId?: string;
          },
          any
        >;
      };
    };
    internalQueries: {
      getRoutine: {
        getRoutine: FunctionReference<
          "query",
          "internal",
          { routineId: Id<"routines"> },
          any
        >;
      };
      getRoutinesNeedingGeneration: {
        getRoutinesNeedingGeneration: FunctionReference<
          "query",
          "internal",
          any,
          any
        >;
      };
      getRoutineTask: {
        getRoutineTask: FunctionReference<
          "query",
          "internal",
          { routineTaskId: Id<"routineTasks"> },
          any
        >;
      };
    };
    queries: {
      getRoutineTaskByTodoistId: {
        getRoutineTaskByTodoistId: FunctionReference<
          "query",
          "internal",
          { todoistTaskId: string },
          any
        >;
      };
    };
  };
  todoist: {
    computed: {
      mutations: {
        extractProjectMetadata: {
          extractProjectMetadata: FunctionReference<
            "mutation",
            "internal",
            { projectId?: string },
            any
          >;
        };
        triggerMetadataExtraction: {
          triggerMetadataExtraction: FunctionReference<
            "mutation",
            "internal",
            any,
            any
          >;
        };
      };
    };
    internalMutations: {
      clearAllData: {
        clearAllData: FunctionReference<"mutation", "internal", {}, any>;
      };
      createProjectMetadata: {
        createProjectMetadata: FunctionReference<
          "mutation",
          "internal",
          {
            description?: string;
            last_updated: number;
            priority?: number;
            project_id: string;
            project_type?: "area-of-responsibility" | "project-type";
            scheduled_date?: string;
            source_task_id?: string;
            sync_version: number;
          },
          any
        >;
      };
      createQueueState: {
        createQueueState: FunctionReference<
          "mutation",
          "internal",
          {
            currentIndex?: number;
            queueId: string;
            taskSnapshot: Array<string>;
          },
          any
        >;
      };
      initializeSyncState: {
        initializeSyncState: FunctionReference<
          "mutation",
          "internal",
          any,
          any
        >;
      };
      logWebhookEvent: {
        logWebhookEvent: FunctionReference<
          "mutation",
          "internal",
          {
            delivery_id: string;
            error_message?: string;
            event_data_summary: { entity_id: string; entity_type: string };
            event_name: string;
            initiator_email?: string;
            initiator_id?: string;
            processed_at: number;
            processing_time_ms?: number;
            status: "success" | "failed" | "skipped";
            triggered_at: string;
            user_id: string;
            version: string;
          },
          any
        >;
      };
      resetProjectMetadata: {
        resetProjectMetadata: FunctionReference<
          "mutation",
          "internal",
          { metadataId: Id<"todoist_project_metadata">; projectId: string },
          any
        >;
      };
      updateItem: {
        updateItem: FunctionReference<
          "mutation",
          "internal",
          {
            todoistId: string;
            updates: {
              checked?: boolean;
              completed_at?: string | null;
              content?: string;
              deadline?: null | { date: string; lang: string };
              description?: string;
              due?: null | {
                date: string;
                datetime?: string;
                is_recurring?: boolean;
                string?: string;
                timezone?: string | null;
              };
              is_deleted?: boolean;
              labels?: Array<string>;
              priority?: number;
              project_id?: string;
              section_id?: string;
              sync_version?: number;
              updated_at?: string;
            };
          },
          any
        >;
      };
      updateProjectMetadata: {
        updateProjectMetadata: FunctionReference<
          "mutation",
          "internal",
          {
            metadataId: Id<"todoist_project_metadata">;
            updates: {
              description?: string | null;
              last_updated: number;
              priority?: number | null;
              project_id: string;
              project_type?: "area-of-responsibility" | "project-type" | null;
              scheduled_date?: string | null;
              sync_version: number;
            };
          },
          any
        >;
      };
      updateQueueProgress: {
        updateQueueProgress: FunctionReference<
          "mutation",
          "internal",
          {
            action: "next" | "previous" | "skip" | "complete" | "jump";
            newIndex?: number;
            queueStateId: Id<"todoist_queue_states">;
            taskId?: string;
          },
          any
        >;
      };
      updateSyncToken: {
        updateSyncToken: FunctionReference<
          "mutation",
          "internal",
          { token: string },
          any
        >;
      };
      upsertItem: {
        upsertItem: FunctionReference<
          "mutation",
          "internal",
          {
            force?: boolean;
            item: {
              added_at?: string | null;
              added_by_uid?: string | null;
              assigned_by_uid?: string | null;
              checked?: boolean | number;
              child_order?: number;
              comment_count?: number;
              completed_at?: string | null;
              completed_by_uid?: string | null;
              content: string;
              date_added?: string | null;
              date_completed?: string | null;
              day_order?: number;
              deadline?: { date: string; lang: string } | null;
              description?: string;
              due?: {
                date: string;
                datetime?: string;
                is_recurring?: boolean;
                lang?: string;
                string?: string;
                timezone?: string | null;
              } | null;
              duration?: { amount: number; unit: string } | null;
              id: string;
              is_collapsed?: boolean;
              is_deleted?: boolean | number;
              labels?: Array<string>;
              note_count?: number;
              parent_id?: string | null;
              priority?: number;
              project_id?: string | null;
              responsible_uid?: string | null;
              section_id?: string | null;
              updated_at?: string | null;
              url?: string;
              user_id?: string | null;
            };
          },
          any
        >;
      };
      upsertLabel: {
        upsertLabel: FunctionReference<
          "mutation",
          "internal",
          {
            label: {
              color?: string;
              id: string;
              is_deleted?: boolean | number;
              is_favorite?: boolean | number;
              item_order?: number;
              name: string;
            };
          },
          any
        >;
      };
      upsertNote: {
        upsertNote: FunctionReference<
          "mutation",
          "internal",
          {
            note: {
              content: string;
              file_attachment?: {
                file_name: string;
                file_size: number;
                file_type: string;
                file_url: string;
                upload_state: string;
              } | null;
              id: string;
              is_deleted?: boolean | number;
              item_id: string;
              posted_at: string;
              posted_uid: string;
              project_id?: string;
              reactions?: Record<string, Array<string>> | null;
              uids_to_notify?: Array<string> | null;
            };
          },
          any
        >;
      };
      upsertProject: {
        upsertProject: FunctionReference<
          "mutation",
          "internal",
          {
            project: {
              access?: { configuration?: any; visibility: string };
              can_assign_tasks?: boolean;
              child_order?: number;
              collapsed?: boolean;
              color?: string;
              created_at?: string;
              creator_uid?: string;
              default_order?: number;
              description?: string;
              id: string;
              inbox_project?: boolean;
              is_archived?: boolean | number;
              is_collapsed?: boolean;
              is_deleted?: boolean | number;
              is_favorite?: boolean | number;
              is_frozen?: boolean;
              is_shared?: boolean;
              name: string;
              parent_id?: string | null;
              public_access?: boolean;
              public_key?: string;
              role?: string;
              shared?: boolean;
              updated_at?: string;
              view_style?: string;
            };
          },
          any
        >;
      };
      upsertReminder: {
        upsertReminder: FunctionReference<
          "mutation",
          "internal",
          {
            reminder: {
              date?: string;
              due?: {
                date: string;
                datetime?: string;
                is_recurring?: boolean;
                lang?: string;
                string?: string;
                timezone?: string | null;
              } | null;
              id: string;
              is_deleted?: boolean | number;
              is_urgent?: boolean;
              item_id: string;
              minute_offset?: number;
              mm_offset?: number;
              notify_uid: string;
              service?: string;
              type: string;
            };
          },
          any
        >;
      };
      upsertSection: {
        upsertSection: FunctionReference<
          "mutation",
          "internal",
          {
            section: {
              added_at?: string;
              collapsed?: boolean;
              date_added?: string;
              date_archived?: string;
              id: string;
              is_archived?: boolean | number;
              is_deleted?: boolean | number;
              name: string;
              project_id: string;
              section_order?: number;
              user_id?: string;
            };
          },
          any
        >;
      };
    };
    internalQueries: {
      getFilteredActiveItems: {
        getFilteredActiveItems: FunctionReference<
          "query",
          "internal",
          {
            assigneeFilter?:
              | "all"
              | "unassigned"
              | "assigned-to-me"
              | "assigned-to-others"
              | "not-assigned-to-others";
            currentUserId?: string;
            includeCompleted?: boolean;
            includeStarPrefix?: boolean;
            label?: string;
            limit?: number;
            priority?: number;
            projectId?: string;
          },
          any
        >;
      };
      getRawActiveItems: {
        getRawActiveItems: FunctionReference<
          "query",
          "internal",
          { limit?: number; projectId?: string },
          any
        >;
      };
      getSyncState: {
        getSyncState: FunctionReference<"query", "internal", any, any>;
      };
    };
    mutations: {
      reorderProjectSiblings: {
        reorderProjectSiblings: FunctionReference<
          "mutation",
          "internal",
          { parentId: string | null },
          any
        >;
      };
    };
    queries: {
      getItemByTodoistId: {
        getItemByTodoistId: FunctionReference<
          "query",
          "internal",
          { todoistId: string },
          any
        >;
      };
      getWebhookEventByDeliveryId: {
        getWebhookEventByDeliveryId: FunctionReference<
          "query",
          "internal",
          { deliveryId: string },
          any
        >;
      };
    };
    sync: {
      performIncrementalSync: {
        performIncrementalSync: FunctionReference<
          "action",
          "internal",
          any,
          any
        >;
      };
      runInitialSync: {
        runInitialSync: FunctionReference<"action", "internal", any, any>;
      };
    };
  };
};

export declare const components: {};
