# Client-to-Mini cutover census

Research against `main` at `04e6179`. No files changed and no tests run.

Path abbreviations used in citations:

- `C/` = `/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/`
- `S/` = `/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/`
- `V/` = `/Users/mimen/Programming/Repos/convex-db/convex/`
- `I/` = `/Users/mimen/Programming/Repos/convex-db/apps/imsg/`

The census covers every `request(...)` and `fetch(...)` in `api.ts`, direct component requests, media URL helpers, and `/events`. Tests and fixtures are excluded from production callers.

## Findings that affect the cutover

1. **Mentions already work through the bridge command.** The outbox `send` validator includes mentions and reply-part information, and `ChatCommands.send` builds the attributed body. The client explicitly rejects mention sends from its Convex path. This is a client routing gap, not a missing bridge capability. [`V/schema/comma/validators.ts:156`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:156), [`S/commands.ts:24`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/commands.ts:24), [`C/lib/api.ts:66`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:66).

2. **Schedule create, edit, and cancel already have outbox commands.** The client still calls REST. The bridge discards the create/edit result, so preserving the current `ScheduledMessage` return requires a result mechanism. [`V/schema/comma/validators.ts:182`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:182), [`S/bridge/outbox.ts:118`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.ts:118), [`C/lib/api.ts:195`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:195).

3. **Ordinary text sends still bypass Convex in several places.** Forwarding, failed-message retry, and “Send again” use `api.sendText`, regardless of mentions. [`C/components/forward-content.tsx:32`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/forward-content.tsx:32), [`C/components/thread-view.tsx:363`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/thread-view.tsx:363), [`C/components/thread-view.tsx:437`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/thread-view.tsx:437).

4. **Storage coverage is incomplete by design.** Attachment URLs fall back to the Mini while originals or thumbnails are missing. Gallery callers pass GUID strings, which always take that fallback. Contact avatars also fall back to the Mini; group photos always use it. [`C/lib/api.ts:260`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:260), [`C/lib/convex-adapters.ts:89`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/convex-adapters.ts:89), [`C/components/chat-info-content.tsx:147`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/chat-info-content.tsx:147).

5. **AI cannot simply become a direct Convex action with current dependencies.** The gateway defaults to Mini loopback, suggestions read a vault profile and local learning state, and identification searches the vault filesystem. Use bridge request/response commands unless those dependencies are deliberately moved. [`S/config.ts:98`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/config.ts:98), [`S/ai/service.ts:140`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/ai/service.ts:140), [`S/ai/service.ts:194`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/ai/service.ts:194), [`S/ai/service.ts:449`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/ai/service.ts:449).

## Proposed contract notation

The following are proposals, not existing functions.

- **A**: authenticated Convex query over mirrored data.
- **B**: fire-and-forget outbox command.
- **C**: enqueue command, bridge executes it, client subscribes to its result.
- **D**: Convex action calling a public external service directly.
- **E**: bridge-published ephemeral state.
- **F**: delete the obsolete call.

For every B/C row below:

```ts
enqueue({
  clientKey: string,
  conversationId?: Id<"comma_conversations">,
  payload: CommandPayload
}): Id<"comma_outbox">

getCommand({
  commandId: Id<"comma_outbox">
}): null | {
  commandId: Id<"comma_outbox">,
  clientKey: string,
  status: "pending" | "claimed" | "sent" | "failed" | "unknown",
  error?: string,
  result?: CommandResult,
  updatedAt: number
}
```

B returns the command ID immediately. C waits through a subscription, returning the typed result on `sent` and surfacing `failed`/`unknown`.

Make `conversationId` optional only for explicitly global or new-chat payloads. Existing conversation commands must still require a valid conversation. Today both schema and enqueue require it. [`V/schema/comma/validators.ts:222`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:222), [`V/comma/outbox.ts:26`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:26).

The return names below mean the exact existing shared contracts:

| Name | Exact source |
|---|---|
| `Message`, including attachment summaries, mentions, reactions and delivery fields | [`I/shared/types.ts:42`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/shared/types.ts:42) |
| `Contact = {address:string,name:string,is_favorite?:boolean}` | [`I/shared/types.ts:159`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/shared/types.ts:159) |
| `ScheduledMessage = {id:number,chatGuid:string,chatName:string,text:string,sendAt:number,status:ScheduledMessageStatus,error:string|null,sentAt:number|null}` | [`I/shared/types.ts:184`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/shared/types.ts:184) |
| `TranscriptState = {state:"not-requested"} \| {state:"working"} \| {state:"ready",text:string} \| {state:"unavailable",detail:string} \| {state:"failed",error:string}` | [`I/shared/types.ts:216`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/shared/types.ts:216) |
| `ReplySuggestions`, including selected/served model, fallback, anchor, stale and generation time | [`I/shared/types.ts:272`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/shared/types.ts:272) |
| `SuggestionFeedbackRequest`, including full suggestion, models, recipe, selection time and final text | [`I/shared/types.ts:287`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/shared/types.ts:287) |

Sizes mean S for an existing-capability adapter, M for a new query or command, and L for new state/storage/lifecycle machinery.

## Every REST call in `api.ts`

Each row includes all production callers found, including multiline `api` expressions.

| Client function and callers | Mini route, handler and real work | Existing Convex data/capability | Proposed mechanism, exact payload/args and result | Size |
|---|---|---|---|---|
| `messages(chatGuid,window?)`, [`C/lib/api.ts:55`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:55). `C/hooks/use-messages.ts:120,146,173,198`: around, older, newer, reconciliation windows. | `GET /api/chats/:guid/messages`, [`S/app.ts:253`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:253). BlueBubbles message reads across service siblings; around fetches 40 rows on either side; normal paging skips tapbacks/retracted rows through `buildThread`. | `comma_messages`, `comma_attachments`; `listMessages` already joins storage URLs but has no timestamp-window API. `V/comma/queries.ts:100`; indexes at `V/schema/comma/index.ts:27`. | **A** `messageWindow({conversationId,before?:number,after?:number,around?:number}): Message[]`. Around uses `<= around` descending 40 and `> around` ascending 40; before/after use strict bounds. Join attachments and preserve hidden/retracted/tapback filtering. No new source mirroring needed for already-backfilled history. | M |
| `sendText`, [`C/lib/api.ts:77`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:77). `C/components/composer.tsx:491,532`; `forward-content.tsx:32`; `thread-view.tsx:363,437`. | `POST /api/chats/:guid/send`, [`S/app.ts:413`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:413). `ChatCommands.send` validates text, builds mention attributed body when supported, calls BlueBubbles, maps message and updates directory. `S/commands.ts:24`. | Existing `send` outbox payload and executor, including mentions and reply part. `V/schema/comma/validators.ts:156`; `S/bridge/outbox.ts:90`. | **C** existing payload `{kind:"send",text,replyToGuid?,replyToPart?,mentions?:{start,length,address}[]}`; result `{kind:"send",message:Message}`. Preserves current forward/retry acknowledgements. Also remove `enqueueTextSend`’s mention rejection and pass all supported fields for its existing immediate queue path. | S after result foundation |
| `react`’s `suggested:true` branch, [`C/lib/api.ts:108`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:108). `C/components/suggestion-shelf.tsx:164`. Ordinary reactions already use outbox, `thread-view.tsx:403`. | `POST /api/messages/:guid/react`, [`S/app.ts:520`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:520). BlueBubbles target/reaction reread; validates chat membership, part zero, and inbound target for suggestions; suppresses redundant reaction. `S/commands.ts:48`. | `react` exists, but its validator lacks `suggested`. Executor calls the same guarded method without that flag. `V/schema/comma/validators.ts:163`; `S/bridge/outbox.ts:95`. | **C** `{kind:"react",messageGuid,reaction,remove:boolean,partIndex?:number,suggested?:boolean}` → `{kind:"react",ok:true}`. Preserve the inbound guard and wait for success before recording feedback. | S |
| `contacts(q)`, [`C/lib/api.ts:135`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:135). `C/components/new-chat-content.tsx:72`; `command-palette.tsx:126,400`; `search-content.tsx:49`; `composer.tsx:186` contact-card picker. | `GET /api/contacts`, [`S/app.ts:571`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:571). Union of Convex Identity Mirror search and BlueBubbles Apple ContactBook search, address-deduped, 25 results, mirror preferred. | `people`, `identities`, CRM; `identity/queries:listPeople`, `nameDirectory`, `searchPeople`. `V/identity/queries.ts:184,226,282`. Apple contacts ingest exists, `S/identity-sync.ts:49`. Current `searchPeople` only searches display name. | **A** `identity/queries:searchContacts({key:string,q:string,limit?:number}): Contact[]`, default/cap 25. Search display/first/last/nickname/organization/name combinations plus normalized addresses; flatten phones/emails, dedupe, carry favorite. Keep Apple ingest running. Unsynced Apple contacts lose the current local freshness fallback until ingest catches up. | M |
| `sendContactCard`, [`C/lib/api.ts:138`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:138). `C/components/composer.tsx:561`. | `POST /api/chats/:guid/contact`, [`S/app.ts:447`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:447). Builds vCard bytes, calls BlueBubbles attachment-with-caption, maps message. | Missing command. Identity data exists, but this is sending an attachment, not editing a contact. | **C** `{kind:"sendContact",name:string,address:string,caption?:string}` → `{kind:"sendContact",message:Message}`. Build vCard in bridge; preserve caption behavior. | M |
| `findChat(address)`, [`C/lib/api.ts:145`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:145). `C/components/search-content.tsx:62`. | `GET /api/chats/find`, [`S/app.ts:534`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:534). Searches directory for a matching one-person DM; optional service choice; returns `{chatGuid,service,isGroup:false,participants:string[]}`. `S/chat-directory.ts:492`. | `comma_conversations.conversationKey`, participants, primary GUID; aliases contain service. `V/schema/comma/validators.ts:53`; `V/schema/comma/index.ts:18`. Missing address lookup function. | **A** `findChat({address:string,service?:"iMessage"|"SMS"}): null|{chatGuid:string,service:"iMessage"|"SMS",isGroup:false,participants:string[]}`. Use the shared conversation/address normalization, then select the appropriate alias. Adapter can retain the current `{chatGuid}` public shape and reject a miss. | S |
| `newChat`, [`C/lib/api.ts:148`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:148). `C/components/new-chat-content.tsx:108`; `command-palette.tsx:460`. | `POST /api/chats/new`, [`S/app.ts:594`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:594). BlueBubbles creates chat and sends first text; validates recipient set, exact outbound message, service and error; returns GUID, participants, service and message. | Missing command. Existing enqueue requires a conversation that does not exist yet. `V/comma/outbox.ts:27`; bridge unconditionally resolves conversation, `S/bridge/outbox.ts:63`. | **C**, no initial conversation ID: `{kind:"createChat",addresses:string[],text:string}` → `{kind:"createChat",chatGuid:string,service:"iMessage",isGroup:boolean,participants:string[],message:Message}`. Validate as today, mirror chat/message before completing, then navigate from result. | L |
| `search(q,{from})` fallback, [`C/lib/api.ts:151`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:151). **No production caller supplies `from`.** Calls without it: `C/components/search-content.tsx:48`; `command-palette.tsx:126`; `conversations/use-conversation-search.ts:70`. | `GET /api/search`, [`S/app.ts:623`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:623). `MessageSearch` calls BlueBubbles SQL-style text/sender search. `S/message-search.ts:17`; SQL sender condition `S/bluebubbles.ts:300`. | `comma_messages.isFromMe` already mirrored. Search index lacks it as a filter; query has only query/conversation args. `V/schema/comma/index.ts:32`; `V/comma/queries.ts:132`. | **A** extend `searchMessages({query:string,conversationId?:Id,from?:"me"|"them"}): Message[]`, adding `isFromMe` to search filter fields and filtering before the limit. Remove REST fallback. Decide explicitly whether existing substring/attributed-body search semantics must be preserved; current Convex full-text search is already different. | S |
| `gallery`, [`C/lib/api.ts:169`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:169). `C/components/chat-info-content.tsx:95`. | `GET /api/chats/:guid/gallery`, [`S/app.ts:632`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:632). BlueBubbles scans up to eight 200-message pages, collecting visible image/video attachments, stopping at 120. | Attachment metadata and message dates exist in `comma_attachments`/`comma_messages`; attachment conversation index exists. `V/schema/comma/validators.ts:110`; `V/schema/comma/index.ts:37`. Missing gallery query. | **A** `gallery({conversationId,limit?:number}): Array<{guid,mimeType:string|null,filename:string|null,isImage:boolean,isVideo:boolean,dateCreated:number,thumbUrl:string|null,originalUrl:string|null}>`, cap 120. Join message dates, newest first, use shared visibility/dedup rules. Include URLs so gallery stops passing bare GUIDs to Mini helpers. | M |
| `chatInfo`, [`C/lib/api.ts:172`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:172). `C/components/chat-info-content.tsx:91`; `thread-view.tsx:180`, supplying participants for mentions when header data is absent. | `GET /api/chats/:guid/info`, [`S/app.ts:680`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:680). BlueBubbles chat read plus contacts/name resolution; raw nullable group name and participants. | Conversations already carry participants and group status. `resolveChat` exists. **Raw nullable group name is missing**: mirrored display name is the mapped presentation name. `V/comma/queries.ts:147`; `S/bridge/mapper.ts:38`. | **A** `chatInfo({chatGuid:string}): null|{guid:string,displayName:string|null,isGroup:boolean,participants:Contact[]}`. Mirror `rawDisplayName?:string`; query joins current identity names. Do not populate rename field with a generated participant-list name. | M |
| `participant`, [`C/lib/api.ts:183`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:183). `C/components/chat-info-content.tsx:141,310`. | `POST /api/chats/:guid/participant`, [`S/app.ts:704`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:704). BlueBubbles private API add/remove participant, invalidate directory. | Missing command; participants themselves mirrored. | **C** `{kind:"participant",address:string,action:"add"|"remove"}` → `{kind:"participant",ok:true}`. Preserve failure toast; refresh/mirror group before receipt so subscribed info changes after success. | M |
| `leaveGroup`, [`C/lib/api.ts:189`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:189). `C/components/chat-info-content.tsx:386`. | `POST /api/chats/:guid/leave`, [`S/app.ts:716`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:716). BlueBubbles private API leave, directory invalidation. | Missing command. | **C** `{kind:"leaveGroup"}` → `{kind:"leaveGroup",ok:true}`. Close UI after bridge success; refresh mirrored group membership/state. | M |
| `deleteChat`, [`C/lib/api.ts:192`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:192). `C/components/chat-info-content.tsx:409`. | `POST /api/chats/:guid/delete`, [`S/app.ts:724`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:724). BlueBubbles delete, delete local suggestion feedback, invalidate/broadcast directory. | Missing command and deletion propagation. Conversation ingest only upserts; refresh does not remove absent conversations. `V/comma/internal.ts:58`; `S/bridge/live.ts:66`. | **C** `{kind:"deleteChat",chatGuid:string}` → `{kind:"deleteChat",ok:true}`. Explicit GUID preserves deletion of the selected service chat; remove its alias and affected mirror data, retaining surviving siblings. Preserve local feedback cleanup. Complete after mirror update. | L |
| `schedule`, [`C/lib/api.ts:195`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:195). `C/components/composer.tsx:913,1006`. | `POST /api/scheduled`, [`S/app.ts:754`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:754). BlueBubbles durable scheduler create through `ChatCommands.schedule`; map result/name. `S/commands.ts:102`. | Existing `{kind:"schedule",text,sendAt}` and executor; `comma_scheduled` mirrored. `V/schema/comma/validators.ts:182`; `S/bridge/outbox.ts:118`. | **C** existing `{kind:"schedule",text:string,sendAt:number}` → `{kind:"schedule",scheduled:ScheduledMessage}`. Retain validation and return persisted scheduler ID/state; publish scheduled mirror before receipt. | S |
| `updateScheduled`, [`C/lib/api.ts:201`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:201). `C/hooks/use-scheduled.ts:44`. | `PUT /api/scheduled/:id`, [`S/app.ts:762`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:762). Scheduler update, then BlueBubbles reread because PUT is sparse. `S/bluebubbles.ts:533`. | Existing `editScheduled` command. `V/schema/comma/validators.ts:183`; `S/bridge/outbox.ts:119`. | **C** `{kind:"editScheduled",bbId:number,text:string,sendAt:number}` → `{kind:"editScheduled",scheduled:ScheduledMessage}`. Preserve reread and original chat selection. | S |
| `cancelScheduled`, [`C/lib/api.ts:207`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:207). `C/hooks/use-scheduled.ts:32`. | `DELETE /api/scheduled/:id`, [`S/app.ts:771`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:771). BlueBubbles schedule deletion. | Existing `cancelScheduled`; UI still REST. `V/schema/comma/validators.ts:189`; `S/bridge/outbox.ts:120`. | **C** `{kind:"cancelScheduled",bbId:number}` → `{kind:"cancelScheduled",ok:true}`. Resolve target through scheduled row when caller has only ID; preserve optimistic hiding and rollback on execution failure. | S |
| `sendScheduledNow`, [`C/lib/api.ts:210`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:210). `C/hooks/use-scheduled.ts:37`. | `POST /api/scheduled/:id/send-now`, [`S/app.ts:778`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:778). Lists schedule, validates it, updates same job to `now+250`; local concurrent-claim guard. **Does not send separate text.** `S/scheduled-send-now.ts:28`. | Schedule mirror exists; command missing. | **C** `{kind:"sendScheduledNow",bbId:number}` → `{kind:"sendScheduledNow",ok:true}`. Reuse `ScheduledSendNow`; preserve scheduler’s sole ownership of actual delivery. | M |
| `transcriptState`, [`C/lib/api.ts:213`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:213). `C/components/media.tsx:52,67`, initial request plus 1-second polling. | `GET /api/attachments/:guid/transcript`, [`S/app.ts:792`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:792). SQLite cached text plus Whisper in-memory working/failure/availability state. `S/whisper.ts:126`. | `comma_attachments.transcript` and `setTranscript` exist. Full state missing. `V/schema/comma/validators.ts:128`; `V/comma/internal.ts:272`. | **A** `transcriptState({attachmentGuid:string}): TranscriptState`. Add mirrored state/error/detail, consult bridge capability for unavailable. Subscribe instead of polling. | M |
| `transcribe`, [`C/lib/api.ts:216`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:216). `C/components/media.tsx:83`. | `POST /api/attachments/:guid/transcript`, [`S/app.ts:796`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:796). Starts queued local job; BlueBubbles metadata/download, filesystem, macOS `afconvert`, local Whisper binary/model, SQLite text. `S/whisper.ts:175`. | Text storage only; no command. Bridge copies existing transcripts **once on startup**, not each new result. `S/bridge/media.ts:58`; `S/bridge/index.ts:63`. | **C** `{kind:"transcribe",attachmentGuid:string}` → `{kind:"transcribe",transcript:TranscriptState}`. Publish working then terminal state/text; bridge awaits `WhisperService.transcribe`, not its immediate `request` reply. Requires long-job lease handling. | L |
| `createFaceTimeLink`, [`C/lib/api.ts:219`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:219). `C/components/facetime-button.tsx:47`. | `POST /api/chats/:guid/facetime-link`, [`S/app.ts:667`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:667). BlueBubbles creates FaceTime session link then sends it as text. `S/facetime.ts:5`. | Missing command; ordinary text send exists. | **C** `{kind:"createFaceTimeLink"}` → `{kind:"createFaceTimeLink",message:Message}`. Link creation needs the Mac; keep both steps bridge-side and return sent message. | M |
| `health`, [`C/lib/api.ts:222`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:222). `C/hooks/use-health.ts:15`; hook consumed by `C/components/thread-view.tsx:92`. | `GET /api/health`, [`S/app.ts:218`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:218). In-process private API capability, SSE client count, bridge health. No BlueBubbles request in handler. | `syncStatus` has progress timestamps/counters, but not `privateApi`. `V/comma/queries.ts:182`; `V/schema/comma/validators.ts:301`. | **E** bridge publishes `comma_bridge_state` singleton `{key:"mini",privateApi:boolean,suggestions:boolean,reactionSuggestions:boolean,whisperAvailable:boolean,whisperDetail?:string,lastSeenAt:number}`. Query `bridgeState({})` returns it or null; `usePrivateApi` reads flag. Keep REST health for deploy callers. | M |
| `refreshIdentity`, [`C/lib/api.ts:231`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:231). `C/hooks/use-airtable-search.ts:79`; `C/components/person-content.tsx:168,224`. | `POST /api/identity/refresh`, [`S/app.ts:230`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:230). Refresh server’s Convex identity read replica; invalidate directory. This does **not** ingest Apple Contacts. | Identity edits already happen in Convex; query joins currently add photo URLs but retain mirrored participant names. `V/comma/queries.ts:54`; identity lookup `V/comma/photos.ts:6`. | **F** remove call and function, with no replacement args/result. First make conversation/message display names derive reactively from `people`/`identities`; otherwise deletion leaves stale denormalized names. Server Identity Mirror can continue its internal refresh lifecycle. | M |
| `aiStatus`, [`C/lib/api.ts:236`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:236). `C/hooks/use-ai.ts:22`; consumed by `thread-view.tsx:93`, `chat-info-content.tsx:74`, `settings-content.tsx:119`. | `GET /api/ai/status`, [`S/app.ts:924`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:924). Gateway configuration availability and BlueBubbles private API flag. | Missing capability record. Suggestions table does not express availability. | **E** same bridge-state singleton; `aiStatus({}): {suggestions:boolean,reactionSuggestions:boolean}`. A query adapter reads published capabilities; no LLM request. | S with health work |
| `aiSuggestions`, [`C/lib/api.ts:240`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:240). `C/components/suggestion-shelf.tsx:86`; `sweep-overlay.tsx:114`. | `GET /api/ai/suggestions/:guid?model&refresh`, [`S/app.ts:931`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:931). BlueBubbles recent messages/reactions/outbound examples, SQLite cache/learning/cooldowns, vault profile, gateway LLM with fallback/validation. `S/app.ts:126`; `S/ai/service.ts:123,194,306`. | `comma_suggestions` and `getSuggestions` exist. Precompute only does known nonspam DMs, only `opus`; table stores one shelf per conversation. `S/bridge/suggestions.ts:97`; `V/comma/internal.ts:578`. | **C** `{kind:"suggestions",model:"opus"|"terra",refresh:boolean}` → `{kind:"suggestions",suggestions:ReplySuggestions}`. Query cache first when anchor/model match; otherwise command runs existing AI service and publishes result. Add model-specific shelf indexing; preserve stale detection and precompute limits. | L |
| `recordSuggestionFeedback`, [`C/lib/api.ts:245`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:245). `C/components/composer.tsx:528,545`; `suggestion-shelf.tsx:170`; `sweep-overlay.tsx:70`. | `POST /api/ai/suggestions/:guid/feedback`, [`S/app.ts:943`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:943). SQLite feedback write; text lineage validation; reaction feedback write; no LLM call. `S/ai/service.ts:385,408`. | Missing mirrored feedback/learning tables and command. Existing `comma_suggestions` holds generated choices only. `V/schema/comma/index.ts:62`. | **B** `{kind:"suggestionFeedback",feedback:SuggestionFeedbackRequest}` → command ID. Bridge applies existing lineage validation and local learning write. Tie feedback to confirmed send/reaction so queue acceptance does not falsely count as delivery; use command key to dedupe feedback on retry. | M |
| `clearSuggestionLearning`, [`C/lib/api.ts:251`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:251). `C/components/settings-content.tsx:243`. | `DELETE /api/ai/suggestions/learning`, [`S/app.ts:951`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:951). Clears local SQLite learning through AI service. `S/ai/service.ts:429`. | Missing global command. | **C**, no conversation ID: `{kind:"clearSuggestionLearning"}` → `{kind:"clearSuggestionLearning",ok:true}`. Preserve settings success/failure callback; invalidate affected published shelves alongside local learning. | M |
| `aiIdentify`, [`C/lib/api.ts:254`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:254). `C/components/chat-info-content.tsx:83`. | `GET /api/ai/identify/:guid`, [`S/app.ts:956`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:956). BlueBubbles participant/messages, contacts/name lookup, vault phone-number search, gateway LLM. `S/ai/service.ts:449`; `S/ai/identify.ts:37`. | Identity graph exists; inference result and vault candidate corpus are missing. | **C** `{kind:"identify"}` → `{kind:"identify",contact:{name:string|null,confidence:"high"|"medium"|"low",reasoning:string}}`. Retain Mini vault lookup and existing inference pipeline. | M |

The sender-search REST branch is dormant, but it remains an exported capability and is included above. No other REST method in `api.ts` was found to be wholly unused.

## Direct requests and media URLs outside those methods

| Client function and callers | Mini route, handler and real work | Existing Convex data/capability | Proposed mechanism and exact contract | Size |
|---|---|---|---|---|
| Composer `setTyping`, [`C/components/composer.tsx:388`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/composer.tsx:388). Text changes call it at `:404`; idle timer turns it off after 5 seconds at `:406`. | `POST /api/chats/:guid/typing`, [`S/app.ts:475`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:475). BlueBubbles private API `setTyping`; unsupported returns `{ok:false}`. | Missing outbound typing command. | **B** `{kind:"typing",active:boolean,expiresAt:number}` → command ID. Discard expired “on” commands, coalesce superseded transitions, and auto-clear bridge-side. Ordinary durable FIFO delivery would replay stale typing after downtime. | M |
| Composer `uploadAsset`, [`C/components/composer.tsx:559`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/composer.tsx:559), sends at `:572`; called from attachment loop at `:488`. | `POST /api/chats/:guid/attachment`, [`S/app.ts:426`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:426). Multipart bytes, optional caption; BlueBubbles attachment-with-caption; maps message. | Convex incoming attachment storage exists. Client upload authorization and outgoing command are missing. | **C** authenticated `generateAttachmentUploadUrl({}): string`; POST raw bytes to returned Convex URL → `{storageId}`; enqueue `{kind:"sendAttachment",storageId:Id<"_storage">,filename:string,mimeType:string,caption?:string,isAudioMessage:false}` → `{kind:"sendAttachment",message:Message}`. Bridge downloads storage bytes and sends them. | L |
| Composer voice recorder completion, [`C/components/composer.tsx:870`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/composer.tsx:870), sends at `:886`. | Same attachment route; multipart `isAudioMessage:"true"` selects `bb.sendAudio`. `S/app.ts:433`; `S/bluebubbles.ts:454`. | Same outgoing gaps. | **C** same upload pipeline; `{kind:"sendAttachment",storageId,filename,mimeType:"audio/mp4",isAudioMessage:true}` → `{kind:"sendAttachment",message:Message}`. Preserve voice-message flag instead of treating recording as a generic file. | S after attachment work |
| `LinkPreviewCard` effect, [`C/components/link-preview-card.tsx:30`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/link-preview-card.tsx:30); rendered by `C/components/bubble.tsx:389`. | `GET /api/link-preview?url`, [`S/app.ts:405`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:405). Public-host validation/DNS, external HTTP HTML fetch, metadata extraction, 24-hour in-memory cache. `S/link-preview.ts:38,71`. | Missing. No local Messages data is required. | **D** `linkPreview({url:string}): null|{url:string,title:string|null,description:string|null,image:string|null,siteName:string|null}`. Port public-host/private-network rejection, redirect refusal, timeout and HTML cap to Convex Node action. | M |
| `avatarUrl`, [`C/lib/api.ts:260`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:260); `PersonAvatar` at `C/components/avatar.tsx:50`. Missing/failed Convex photo triggers Mini fallback. | `GET /api/avatars/:address`, [`S/app.ts:351`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:351). `.cache/avatars/*.img` filesystem read; fallback BlueBubbles ContactBook base64; transparent PNG on miss. | `people.photoStorageId`, `identity/queries:whoIs` photo URL, `PhotoMirror` upload/link exist. `V/comma/photos.ts:18`; `V/identity/queries.ts:167`; `S/bridge/photos.ts:34`. | **A** existing `whoIs({key,address})` photo URL. Change helper to `avatarUrl(address,photoUrl?): string|null`; missing/failed photo renders initials. Finish address matching/mirroring for required photos; do not make a Mini fallback URL. | S |
| `groupPhotoUrl`, [`C/lib/api.ts:264`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:264); `ChatAvatar`, `GroupPhotoAvatar` at `C/components/avatar.tsx:122,204`. | `GET /api/chats/:guid/photo`, [`S/app.ts:399`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:399). BlueBubbles chat properties supply photo attachment GUID; download bytes. `S/group-photos.ts:11`. | Only `hasGroupPhoto` exists. Group-photo GUID/storage bytes missing; `PhotoMirror` mirrors contact photos only. `V/schema/comma/validators.ts:64`; `S/bridge/photos.ts:27`. | **A** add `groupPhotoGuid?:string`, `groupPhotoStorageId?:Id<"_storage">` to conversation mirror; bridge uploads bytes when GUID changes. `groupPhoto({chatGuid:string}): string|null`, or include `groupPhotoUrl` in existing conversation query. | M |
| `attachmentUrl`, [`C/lib/api.ts:268`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:268). `C/components/bubble.tsx:173,218`; `chat-info-content.tsx:147,354`; thumbnail helper at `C/lib/api.ts:277`. | `GET /api/attachments/:guid`, [`S/app.ts:865`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:865). BlueBubbles metadata/download; local transcoding/cache; HTTP range support. | `originalStorageId` and `listMessages.originalUrl` exist; background upload may still be pending. `V/comma/queries.ts:123`; `S/bridge/media.ts:115`. | **A** `attachmentMedia({guid:string}): null|{guid:string,thumbUrl:string|null,originalUrl:string|null}`. Helper returns `string|null`, never Mini URL. Pass attachment objects through gallery/lightbox; show pending/unavailable until storage exists. | M |
| `attachmentThumbnailUrl`, [`C/lib/api.ts:275`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/api.ts:275). `C/components/bubble.tsx:227`; `chat-info-content.tsx:354`. | Same GET route with `?w=ceil(displayWidth*2)`; image thumbnail generation in `S/app.ts:878`. | `thumbStorageId`; worker emits 520px JPEG, small GIF bytes, no video thumbnail. `S/bridge/media.ts:98`. | **A** same media query. `attachmentThumbnailUrl(attachment,displayWidth): string|null` selects `thumbUrl ?? originalUrl`; remove width-driven Mini fallback. Existing 520px variant suffices unless additional stored resolutions are explicitly required. | S |
| Shared `start`/`subscribeServerEvents`, [`C/lib/sse.ts:29`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/sse.ts:29). Consumers listed below. | `GET /events`, [`S/app.ts:981`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:981). In-memory SSE fanout of BlueBubbles events and directory changes; 25-second pings. `S/live-events.ts:16`; `S/app.ts:184`. | Durable messages, reactions, conversations and suggestions already exist. Incoming typing state missing. `V/comma/queries.ts:61,100,191`; `V/comma/internal.ts:141`. | **F** delete production SSE transport after its consumers move to live queries. Incoming typing uses **E** separately, as below. `subscribeServerEvents` and `useServerEvents` then have no production contract. | L |

`fetch(att.uri)` and `fetch(recorder.uri)` read selected local/blob assets before upload. They are not additional Mini requests. [`C/components/composer.tsx:566`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/composer.tsx:566), [`C/components/composer.tsx:878`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/components/composer.tsx:878).

### Allowed Mini calls that remain

| Call | Caller and handler | Contract/disposition |
|---|---|---|
| `GET /api/convex-token?refresh=1` | [`C/lib/convex-token.ts:7`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/convex-token.ts:7), used by `C/lib/convex-auth.tsx:11`; [`S/convex-token.ts:53`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/convex-token.ts:53). | Keep. Mini calls Convex Auth with tailnet provider/refresh token and returns `{token:string}`. |
| `GET /api/deploy/status` | [`C/lib/deploy-reload.ts:33`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/deploy-reload.ts:33), installed at `C/app/_layout.tsx:41`; [`S/deploy-status.ts:19`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/deploy-status.ts:19). | Keep. Filesystem release manifest → `{environment,branch:string|null,webSha:string}`. Exact validator: `I/shared/release-identity.ts:45`. |
| App bundle/static resources | [`S/app.ts:1012`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:1012). | Keep built Expo app serving and route rewrites. |

## `/events`: every kind and consumer

The shared union has six kinds. The transport parses and delivers every kind, and always calls `liveMessagePreview.receive` before component listeners. [`I/shared/types.ts:302`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/shared/types.ts:302), [`C/lib/sse.ts:24`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/sse.ts:24).

| Event kind and payload | Actual production consumers | Replacement |
|---|---|---|
| `new-message {chatGuid,message}` | `ThreadView` upserts, marks inbound read and clears typing, `C/components/thread-view.tsx:233`; `SuggestionShelf` marks stale and schedules refresh, `suggestion-shelf.tsx:129`; `MessagesWorkspace` plays receive sound, `messages-workspace.tsx:80`; `liveMessagePreview` caches latest inbound, `C/lib/live-message.ts:9`, merged by `C/hooks/use-messages.ts:52`. | **A** live message/conversation/suggestion queries. Retain mounted-thread mark-read effect on newly observed inbound GUIDs. Sound observer must establish an initial baseline and dedupe GUIDs, avoiding sounds for initial pages, reconnect replay, backfill and ordinary edits. |
| `updated-message {chatGuid,message}` | `ThreadView` upsert at `C/components/thread-view.tsx:233`; `liveMessagePreview` updates/removes latest inbound at `C/lib/live-message.ts:9`. | **A** live `comma_messages` queries. Preserve retraction removal in anchored historical windows too. |
| `reaction {chatGuid,targetGuid,reaction,remove}` | `ThreadView` folds into loaded target at `C/components/thread-view.tsx:241`. | **A** subscribed message rows already hold folded reactions; ingest refolds target from tapback rows, `V/comma/internal.ts:141`. |
| `typing {chatGuid,display}` | `ThreadView` at `C/components/thread-view.tsx:246`; local timeout clears after 12 seconds. | **E** `comma_presence {conversationId,peerTyping:boolean,updatedAt:number,expiresAt:number}`; `presence({conversationId}): null|{peerTyping,updatedAt,expiresAt}`. Bridge maps BB typing to canonical conversation and publishes it. Client must retain an expiry timer; Convex time passing alone does not produce a table update. |
| `resync {}` | `ThreadView` reconciles and marks read, `C/components/thread-view.tsx:252`; `liveMessagePreview` clears cache, `C/lib/live-message.ts:8`. Transport also synthesizes it on reconnect, `C/lib/sse.ts:39`; server emits it on BB reconnect, `S/live-events.ts:69`. | **F** remove transport-resync behavior after all windows are Convex-backed. Keep bridge reconciliation on BB reconnect, `S/bridge/reconcile.ts:88`. |
| `chats-changed {}` | **No production listener acts on it.** The three production hook consumers inspect only the kinds above. Server broadcasts on directory invalidation, `S/app.ts:184`. | **F** remove client dependency. Live conversation queries already replace invalidation/refetch signals. |

`ping` is an SSE transport event, not a `ServerEvent` kind. Only the shared transport consumes it to maintain liveness. [`C/lib/sse.ts:61`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/sse.ts:61), [`C/lib/sse.ts:68`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/client/src/lib/sse.ts:68).

Incoming typing is currently absent from `LiveBridge`’s event branches, which handle messages/send errors and group changes. It needs a new bridge publish path. [`S/bridge/live.ts:148`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/live.ts:148).

## Current outbox contract and execution

### Schema

`comma_outbox` has these fields:

```ts
{
  _id: Id<"comma_outbox">,
  _creationTime: number,
  clientKey: string,
  conversationId: Id<"comma_conversations">,
  payload: CommaOutboxPayload,
  status: "pending" | "claimed" | "sent" | "failed" | "unknown",
  leaseUntil?: number,
  attempts: number,
  error?: string,
  resultGuid?: string,
  createdAt: number,
  updatedAt: number
}
```

Indexes are `by_clientKey` and `by_status_createdAt`. [`V/schema/comma/validators.ts:214`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:214), [`V/schema/comma/validators.ts:222`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:222), [`V/schema/comma/index.ts:52`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/index.ts:52).

All **15** current payload kinds are:

| Kind | Exact payload fields beyond `kind` |
|---|---|
| `send` | `text:string`, `replyToGuid?:string`, `replyToPart?:number`, `mentions?:{start:number,length:number,address:string}[]` |
| `react` | `messageGuid:string`, `reaction:string`, `partIndex?:number`, `remove:boolean` |
| `edit` | `messageGuid:string`, `text:string`, `partIndex?:number` |
| `unsend`, `delete` | `messageGuid:string`, `partIndex?:number` |
| `markRead`, `markUnread`, `settle`, `unsettle` | `messageGuid?:string` |
| `pin`, `mute` | `value:boolean` |
| `rename` | `name:string` |
| `schedule` | `text:string`, `sendAt:number` |
| `editScheduled` | `bbId:number`, `text:string`, `sendAt:number` |
| `cancelScheduled` | `bbId:number` |

Source: [`V/schema/comma/validators.ts:156`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:156) through its `outboxPayload` union at `:191`.

### Lifecycle

| Step | Current behavior and evidence |
|---|---|
| Enqueue | Authenticated mutation dedupes by `clientKey`, inserts pending row, returns row ID. `send` additionally deletes draft and inserts `temp-${clientKey}` message. [`V/comma/outbox.ts:26`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:26). |
| Wake | Bridge subscribes to `pendingOutbox({bridgeKey})`; secret-gated query returns oldest 50 pending rows. A 30-second timer also drains expired claims. [`V/comma/outbox.ts:104`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:104), [`S/bridge/outbox.ts:34`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.ts:34). |
| Claim | Bridge posts `{now,leaseMs:60000,limit:10}` to Convex ingest. Internal mutation expires up to 200 claimed rows, requeues only allowlisted idempotent kinds, marks other expired operations unknown, then claims oldest pending rows and increments attempts. [`S/bridge/outbox.ts:52`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.ts:52), [`V/comma/outbox.ts:117`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:117). |
| Resolve/execute | Resolves required conversation ID to a chat GUID, ensures siblings, executes switch through `ChatCommands` or directory/Overlay. Only `send` returns `resultGuid`. [`S/bridge/outbox.ts:63`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.ts:63), [`S/bridge/outbox.ts:82`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.ts:82). |
| Complete | Posts `{clientKey,status,error?,resultGuid?}`. Completion clears lease and writes outcome. The bridge retains its completion receipt until Convex acknowledges it, so a completion retry does not repeat the BlueBubbles operation. [`S/bridge/outbox.ts:67`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.ts:67), [`V/comma/outbox.ts:148`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:148). |
| Echo | Bridge recognizes remembered `tempGuid` keys; ingest removes corresponding optimistic message when real message arrives. [`S/bridge/live.ts:26`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/live.ts:26), [`S/bridge/live.ts:104`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/live.ts:104), [`V/comma/internal.ts:202`](/Users/mimen/Programming/Repos/convex-db/convex/comma/internal.ts:202). |
| Client observation | `outboxStatusFor({clientKeys})` returns only `{clientKey,status,error?}`, at most 100 keys. It does not expose `resultGuid` or full command rows. [`V/comma/outbox.ts:74`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:74). |

Current retry allowlist is exactly `pin`, `mute`, `markRead`, `markUnread`, `settle`, `unsettle`, `rename`. React, schedule, edit and all other operations are not automatically requeued after expiry. [`V/comma/outbox.ts:19`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:19).

**Can a row carry a result today?** Only a string `resultGuid`. It cannot carry `Message`, new-chat metadata, schedule ID/state, suggestions, identification or transcript state, and clients cannot query even that GUID through the existing status function. [`V/schema/comma/validators.ts:230`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:230), [`V/comma/outbox.ts:76`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:76).

### Foundation required before feature commands

Proposed foundation:

- Add a validated `CommandResult` discriminated union matching the C results above.
- Add authenticated `getCommand` subscription.
- Support global/new-chat commands without inventing a placeholder conversation.
- Add lease renewal or a separate asynchronous execution lane for AI/Whisper/upload work. Whisper allows a 15-minute model process, while current leases are 60 seconds and the batch drains serially. [`S/whisper.ts:72`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/whisper.ts:72), [`S/bridge/outbox.ts:52`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.ts:52).
- Fence renewal/completion with a claim generation/token. Current completion looks up by client key and patches without validating claim ownership or current status. [`V/comma/outbox.ts:156`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.ts:156).
- Preserve no-automatic-retry behavior for sends and other ambiguous side effects; explicitly classify each new command.
- Make storage/media readiness and mirror publication part of completion where callers depend on the returned data.

## Phase 6 attachment storage and outgoing feasibility

Current attachment row:

```ts
{
  guid: string,
  messageGuid: string,
  conversationId: Id<"comma_conversations">,
  mimeType?: string,
  filename?: string,
  transferName?: string,
  uti?: string,
  width?: number,
  height?: number,
  totalBytes?: number,
  transferState?: number,
  isSticker: boolean,
  hideAttachment: boolean,
  isOnDisk: boolean,
  thumbStorageId?: Id<"_storage">,
  originalStorageId?: Id<"_storage">,
  transcript?: string,
  sourceVersion: number
}
```

Source: [`V/schema/comma/validators.ts:110`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/validators.ts:110). It has indexes by GUID, message GUID and conversation ID. [`V/schema/comma/index.ts:37`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/index.ts:37).

Current Phase 6 pipeline:

1. Bridge queues on-disk, visible attachments in SQLite. [`S/bridge/media.ts:35`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/media.ts:35).
2. Uploads thumbnails before originals, newest first; GIF thumbnails preserve animation under 2 MiB; image thumbnails are 520px JPEG; videos currently have no thumbnail. [`S/bridge/media.ts:12`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/media.ts:12), [`S/bridge/media.ts:98`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/media.ts:98).
3. Originals may be browser-friendly transcodes, including HEIC/TIFF to JPEG and CAF/AMR to M4A. Thus `originalStorageId` does not necessarily mean untouched original source bytes. [`S/bridge/media.ts:115`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/media.ts:115).
4. Bridge obtains a secret-gated upload URL, POSTs bytes to it, and writes resulting IDs through ingest. [`S/bridge/convex-ingest.ts:55`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/convex-ingest.ts:55), [`V/comma/ingest.ts:57`](/Users/mimen/Programming/Repos/convex-db/convex/comma/ingest.ts:57).
5. `listMessages` converts IDs to `thumbUrl` and `originalUrl`. [`V/comma/queries.ts:114`](/Users/mimen/Programming/Repos/convex-db/convex/comma/queries.ts:114).

**Outgoing uploads can use Convex storage and then outbox.** The missing pieces are client-authenticated upload issuance, a validated outgoing-upload reference, bridge download, and `sendAttachment` execution. The existing BlueBubbles seam already accepts bytes plus filename/audio/caption. [`S/bluebubbles.ts:437`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bluebubbles.ts:437).

Proposed outgoing state should be separate from incoming `comma_attachments`, because a staged file has no Apple attachment GUID or message GUID yet:

```ts
comma_uploads {
  storageId: Id<"_storage">,
  filename: string,
  mimeType: string,
  totalBytes: number,
  createdAt: number,
  commandId?: Id<"comma_outbox">
}
```

Use a finalize-upload mutation to verify the storage file before enqueue, and link it to the command. Reconcile the sent BlueBubbles attachment into the existing incoming mirror after delivery. Preserve caption fallback: without private API the current seam sends caption as separate text. [`S/bluebubbles.ts:458`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bluebubbles.ts:458).

Removing fallback URLs also requires explicit pending/unavailable rendering. A mirrored attachment row alone does not prove its bytes are uploaded. The backlog query deliberately selects rows missing storage IDs. [`V/comma/internal.ts:548`](/Users/mimen/Programming/Repos/convex-db/convex/comma/internal.ts:548).

## Mini routes that become dead, and routes that stay

The caller search covered the repository, excluding tests, fixtures, generated/build output and dependency directories. Findings below describe checked-in callers, not unobserved external consumers.

### Client feature routes removable after cutover

| Routes | Handler citations | Non-client production callers found |
|---|---|---|
| `GET /api/chats`, `GET /api/counts` | [`S/app.ts:236`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:236), `:246` | None. Already unused by production client. |
| `GET /api/chats/:guid/messages`, `GET /api/chats/:guid/messages/:messageGuid` | [`S/app.ts:253`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:253), `:332` | None. Single-message route already has no production client caller. |
| `GET /api/avatars/:address`, `GET /api/chats/:guid/photo`, `GET /api/attachments/:guid`, `GET /api/link-preview` | [`S/app.ts:351`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:351), `:399`, `:865`, `:405` | None. |
| `POST /api/chats/:guid/send`, `/attachment`, `/contact`, `/typing` | [`S/app.ts:413`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:413), `:426`, `:447`, `:475` | None. |
| `POST /api/chats/:guid/read`, `/unread`, `/dismiss`, `/undismiss`, `/pin`, `/rename` | [`S/app.ts:471`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:471), `:482`, `:487`, `:504`, `:514`, `:696` | None. Client equivalents already enqueue commands. |
| `POST /api/messages/:guid/react`, `/unsend`, `/delete`, `/edit` | [`S/app.ts:520`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:520), `:547`, `:553`, `:561` | None. Only suggested reaction still uses REST. |
| `GET /api/contacts`, `GET /api/chats/find`, `POST /api/chats/new`, `GET /api/search` | [`S/app.ts:571`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:571), `:534`, `:594`, `:623` | None. |
| `GET /api/chats/:guid/gallery`, `/info`; `POST /api/chats/:guid/facetime-link`, `/participant`, `/leave`, `/delete` | [`S/app.ts:632`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:632), `:680`, `:667`, `:704`, `:716`, `:724` | None. |
| `GET /api/scheduled`, `POST /api/scheduled`, `PUT/DELETE /api/scheduled/:id`, `POST /api/scheduled/:id/send-now` | [`S/app.ts:741`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:741), `:754`, `:762`, `:771`, `:778` | None. GET already replaced by Convex. |
| `GET/POST /api/attachments/:guid/transcript` | [`S/app.ts:792`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:792), `:796` | None. |
| All `/api/ai/*` routes in the census | [`S/app.ts:924`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:924), `:931`, `:943`, `:951`, `:956` | None. Bridge calls AI service directly, not these routes: `S/bridge/suggestions.ts:113`. |
| `POST /api/identity/refresh`, `GET /events` | [`S/app.ts:230`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:230), `:981` | None requiring retention. Development proxies forward these paths generically but are not domain consumers. |

The bridge does **not** call the Mini’s feature REST routes. It receives BlueBubbles events/calls the BlueBubbles seam and posts directly to Convex `/comma/ingest/*`. [`S/bridge/live.ts:148`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/live.ts:148), [`S/bridge/convex-ingest.ts:85`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/convex-ingest.ts:85).

Deleting REST handlers does not authorize deleting their underlying services: commands, AI, Whisper, contacts, mapping, thumbnails/transcoding and directory behavior are still bridge dependencies. Current composition wires those services directly. [`S/app.ts:109`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:109), [`S/app.ts:189`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:189), [`S/bridge/index.ts:49`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/index.ts:49).

### Retain these Mini routes

| Route | Handler | Callers/reason |
|---|---|---|
| `GET /api/health` | [`S/app.ts:218`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:218) | Deploy startup health loop, `I/scripts/deploy.sh:166`; status CLI, `I/scripts/deploy-status.sh:25`. Remove client usage only. |
| `GET /api/convex-token` | [`S/convex-token.ts:53`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/convex-token.ts:53) | Client Convex session bootstrap, `C/lib/convex-token.ts:7`. |
| `GET /api/deploy/status` | [`S/deploy-status.ts:19`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/deploy-status.ts:19) | Client release monitor; `I/scripts/deploy.sh:189`, `deploy-status.sh:26`, `deploy-verify.ts:97`. |
| `GET /api/desktop-release` | [`S/desktop-version.ts:69`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/desktop-version.ts:69) | Laptop release stager, `I/scripts/desktop-autoupdate.sh:9,54`; deploy/status/verification at `deploy.sh:192`, `deploy-status.sh:27`, `deploy-verify.ts:98`. |
| `GET /api/desktop-release/artifact/:filename` | [`S/desktop-version.ts:74`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/desktop-version.ts:74) | Artifact URL generated at `I/scripts/desktop-build-release.sh:9`; stager downloads manifest’s artifact at `desktop-autoupdate.sh:164`. |
| `GET /api/desktop-version` | [`S/desktop-version.ts:64`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/desktop-version.ts:64) | No checked-in production caller found. Keep under the requested release-identity exception; compatibility removal is a separate decision. |
| Static bundle/SPA routing | [`S/app.ts:1012`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/app.ts:1012) | Required app hosting. Keep unknown API 404 boundary at `S/app.ts:1006`. |

### Retain these Convex HTTP routes and internal services

These are **not Mini REST routes**:

| Route/service | Caller and registration |
|---|---|
| `POST /comma/ingest/<kind>` | Bridge `S/bridge/convex-ingest.ts:85`; registered [`V/http.ts:112`](/Users/mimen/Programming/Repos/convex-db/convex/http.ts:112); claim/complete routing at `V/comma/ingest.ts:25`. |
| `POST /comma/ingest-upload-url` | Bridge `S/bridge/convex-ingest.ts:58`; registered [`V/http.ts:113`](/Users/mimen/Programming/Repos/convex-db/convex/http.ts:113). |
| `POST /identity/ingest-contacts` | Identity Sync `S/identity-sync.ts:59`; registered [`V/http.ts:101`](/Users/mimen/Programming/Repos/convex-db/convex/http.ts:101). |
| Identity Mirror’s direct Convex queries | `S/identity-mirror.ts:210` for chat CRM; internal five-minute refresh lifecycle at [`S/identity-mirror.ts:53`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/identity-mirror.ts:53). No `/api/identity/refresh` requirement. |
| Development proxying | `I/client/scripts/dev-real-data-proxy.js:6`; [`I/scripts/deployment/preview-server.ts:26`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/scripts/deployment/preview-server.ts:26). Narrow forwarding after cutover to retained routes; remove `/events` forwarding. |

## Implementation order and file ownership

This is a proposed sequence. New files below are explicitly proposed.

### 1. Land shared contracts and execution foundation first

One owner handles:

- `V/schema/comma/validators.ts`, `V/schema/comma/index.ts`.
- `V/comma/outbox.ts`, `V/comma/ingest.ts`.
- `S/bridge/outbox.ts`, `S/bridge/convex-ingest.ts`.
- `C/lib/convex-commands.ts`, new `C/lib/command-results.ts`.
- Relevant `V/comma/testModules.vitest.ts` and test reference registration.

Land all agreed schema additions together: typed command results, optional global/new-chat targeting, lease fencing, raw group name/photo storage, model-specific suggestions, transcript state, bridge state/presence, outgoing-upload references. Current registration/schema points are [`V/schema/comma/index.ts:18`](/Users/mimen/Programming/Repos/convex-db/convex/schema/comma/index.ts:18), [`V/comma/ingest.ts:13`](/Users/mimen/Programming/Repos/convex-db/convex/comma/ingest.ts:13).

Extract per-domain executors into proposed `S/bridge/commands/{messaging,scheduled,media,ai}.ts`; thereafter the central executor dispatches instead of accumulating parallel edits.

Tests:

- Extend `V/comma/outbox.test.ts` for typed results, auth, global targeting, duplicate client keys, claim fencing/renewal, stale completion, expiry classification.
- Extend `S/bridge/outbox.test.ts` for receipt retry without side-effect replay, global commands, long-running commands and unknown outcomes.
- Extend `C/lib/convex-commands.test.ts`; add subscription/result-adapter tests.

Existing tests cover enqueue deduplication/auth and lease/receipt behavior, making them the right foundation suites. [`V/comma/outbox.test.ts:45`](/Users/mimen/Programming/Repos/convex-db/convex/comma/outbox.test.ts:45), [`S/bridge/outbox.test.ts:54`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/outbox.test.ts:54).

### 2. Run independent backend workstreams after the foundation

| Workstream | Proposed owned files | Tests and required cases | Dependencies/shared boundaries |
|---|---|---|---|
| Historical reads/search | New `V/comma/history.ts`; extend search implementation in `V/comma/queries.ts`; shared visibility helpers as needed. | `V/comma/history.test.ts`, `queries.test.ts`: before/after/around boundaries, equal timestamps, sibling messages, sender filtering before limit, attachment/reaction joins, hidden/retracted rows. | Own `queries.ts` during this round. Search schema addition already landed in foundation. |
| Identity/info | `V/identity/queries.ts`; new `V/comma/conversationInfo.ts`; `S/bridge/mapper.ts` raw name mapping. | `V/identity/queries.test.ts`, new `conversationInfo.test.ts`, `S/bridge/mapper.test.ts`: renamed/old/nickname/org terms, normalized phone/email, favorites, nullable raw group name, reactive identity names. | Coordinate shared conversation projection with historical-query owner. Do not let both independently edit `withConversationState`. |
| Messaging/group execution | New `S/bridge/commands/messaging.ts`; `S/commands.ts`; targeted mirror-deletion functions in new `V/comma/deletions.ts`. | New executor/deletion tests; `S/commands.test.ts`: mentions/replies, forward/retry, suggested inbound guard, create-chat verification, participant/leave, sibling-aware deletion and no resurrection. | Central outbox dispatch already landed. Own `commands.ts`; schedule work uses a separate executor file. |
| Scheduling | New `S/bridge/commands/scheduled.ts`; `S/scheduled-send-now.ts`; `S/bridge/scheduled-mirror.ts`. | New scheduled executor tests; existing `scheduled-send-now.test.ts`, `scheduled-mirror.test.ts`: returned ID/state, sparse PUT reread, invalid/past time, cancellation failure, duplicate Send now, no second send path. | Uses existing `ChatCommands.schedule` without concurrent edits to `commands.ts`. |
| Media/transcription | New `V/comma/media.ts`, `V/comma/uploads.ts`; new `S/bridge/commands/media.ts`; `S/bridge/media.ts`, `S/bridge/photos.ts`, `S/whisper.ts`. | New query/upload/executor tests; existing `media.test.ts`, `photos.test.ts`, `whisper.test.ts`: upload auth/finalization, missing storage, caption/audio flags, transcript transitions, retries, group-photo replacement, orphan-upload handling. | Foundation owns schema. Wire service dependencies centrally after executors are ready. |
| AI requests/feedback | New `S/bridge/commands/ai.ts`; `S/bridge/suggestions.ts`; `S/ai/service.ts`; new `V/comma/suggestions.ts`. | Existing AI/bridge suggestion tests plus new result tests: selected-model cache separation, force refresh, anchor changes during generation, fallback, lineage rejection, feedback dedupe and confirmed-send ordering, global clear. | Own suggestion query changes; retain local gateway/vault dependencies. |
| Link previews | New `V/comma/linkPreview.ts`, shared parser/validation helper extracted from `S/link-preview.ts`. | New action/helper tests plus existing `S/link-preview.test.ts`: blocked/private/tailnet hosts, IPv4/IPv6/DNS, redirects, timeout, malformed/non-HTML pages and metadata shape. | Fully independent of bridge/outbox after shared contract decision. |

### 3. Publish ephemeral state, then migrate client consumers

Ephemeral work owns proposed `V/comma/presence.ts`, `V/comma/bridgeState.ts`, `S/bridge/presence.ts`, `S/bridge/state.ts`, and the relevant `S/bridge/live.ts` integration. Test incoming typing true/false/expiry, canonical sibling mapping, stale outbound typing, reconnect and capability freshness. Existing BB event integration is at [`S/bridge/live.ts:148`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/server/bridge/live.ts:148).

Client integration should have **one owner for `api.ts` and `composer.tsx`**. Its work can land in grouped commits:

| Client group | Files | Tests |
|---|---|---|
| Read/query adapters | `C/lib/api.ts`, `convex-api.ts`, `convex-adapters.ts`; `C/hooks/use-messages.ts`; `chat-info-content.tsx`, `search-content.tsx`, `command-palette.tsx`, `new-chat-content.tsx`. | Existing `convex-adapters.test.ts`, `message-window.test.ts`, `contact-order.test.ts`; new adapter tests for every replacement contract and nullable media/info. |
| Send/media adapters | `C/lib/api.ts`; `composer.tsx`, `forward-content.tsx`, `facetime-button.tsx`, `media.tsx`, `bubble.tsx`, `avatar.tsx`; `C/hooks/use-scheduled.ts`. | Existing `attachments.test.ts`, `voice-memo.test.ts`, `avatar.test.tsx`, `scheduled.test.ts`, `delivery-state.test.ts`; request/result tests for upload, mentions, retries and execution errors. |
| SSE removal/AI/capabilities | `C/lib/sse.ts`, `live-message.ts`; `thread-view.tsx`, `messages-workspace.tsx`, `suggestion-shelf.tsx`, `sweep-overlay.tsx`, `settings-content.tsx`; `C/hooks/use-health.ts`, `use-ai.ts`; identity-refresh caller cleanup. | Replace production SSE tests with query-observer tests: sound baseline/dedup, active-thread mark-read, typing expiry, live historical edits, suggestion staleness, model change and command failure. |

Keep fixture transport changes separate from the production census, but update fixtures before deleting modules they import. Fixture currently imports `subscribeServerEvents`, `C/lib/convex.fixture.ts:4`.

### 4. Remove dead REST routes last

One cleanup owner edits:

- `S/app.ts`.
- `I/client/scripts/dev-real-data-proxy.js`.
- `I/scripts/deployment/preview-server.ts`.
- Related route/proxy tests.

Keep app composition, bridge services, session issuance, deploy/release endpoints, operational health, static serving and API 404 behavior.

Final verification should include:

- All feature workflows with Mini `/api/*` denied except the explicit allowlist.
- Convex WebSocket reconnection, Mini offline/return, failed/unknown commands.
- Historical jumps, group changes/deletion, uploads/audio/transcripts, AI refresh/feedback.
- Deploy health/release/desktop artifact checks.
- Existing required typecheck/lint/tests and the whole imsg suite in one process, per [`I/CLAUDE.md:76`](/Users/mimen/Programming/Repos/convex-db/apps/imsg/CLAUDE.md:76).

### Shared-file sequencing

| Shared file | Collision risk | Sequence |
|---|---|---|
| `V/schema/comma/validators.ts`, `index.ts` | Every new command/state feature | Single foundation change first; later additions queue through schema owner. |
| `V/comma/outbox.ts`, `ingest.ts` | Results, global targeting, leases, new publish endpoints | Foundation owns all registration/contracts; domain work uses those contracts. |
| `S/bridge/outbox.ts` | Every command kind | Extract dispatch first; feature executors live in separate files. |
| `S/bridge/index.ts`, `S/app.ts` | Wiring AI/Whisper/media/presence and route deletion | One composition owner wires domain modules; remove routes only after client cutover. |
| `V/comma/queries.ts`, `internal.ts` | History, identity names, media, suggestions, deletion | Prefer new domain modules; serialize edits to existing projections/ingest functions. |
| `C/lib/api.ts`, `convex-api.ts`, `convex-adapters.ts` | Nearly all client replacements | One client integration owner; consume completed backend modules sequentially. |
| `C/components/composer.tsx`, `thread-view.tsx`, `chat-info-content.tsx` | Sends/media/typing/scheduling and query/SSE changes overlap | Treat each component as single-owner work, even when backend tracks run independently. |

Research complete. The remaining work is implementation; no repository files were changed.
