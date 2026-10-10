# Interaction inventory

Every user interaction in `client/src` that writes state or waits on something. Audited at `2bd3fd44` on 2026-10-10. Update a row when its class changes, and update the count in [README.md](README.md).

Classes:

- **OPTIMISTIC.** The UI changes on the same frame as the input, before any server round trip.
- **PARTIAL.** Some visible surface updates at once and another lags. The lagging query is named.
- **SPINNER.** A pending indicator shows, and the result appears after the server answers.
- **WAIT.** Nothing changes until the server or live query updates.

`E(kind)` enqueues `comma/outbox:enqueue` and resolves at acknowledgement. `R(kind)` also watches `comma/outbox:getCommand` until the bridge executes. Enqueue-only callers never see a later bridge failure.

Count at baseline: **104 interactions. 20 OPTIMISTIC, 9 PARTIAL, 21 SPINNER, 54 WAIT.** The target is zero non-optimistic interactions among the writes a user sees. Reads that must fetch (search, history paging, media) count as done when they show a placeholder instantly and never block input.

## Messaging

| Interaction | Handler | Class | Lag or note | Failure shown |
|---|---|---|---|---|
| Send text, reply, mentions | composer.tsx:529,603 → R(send) | PARTIAL | Bubble is local. The sidebar patch waits for an awaited `resolveChat` first | Failed bubble and toast. Draft not restored |
| Retry failed bubble | thread-view.tsx:353 → R(send) | PARTIAL | Local revival is discarded under remote rows in a normal thread | Toast |
| Send again (menu) | thread-view.tsx:432 → R(send) | WAIT | No temp bubble | Toast |
| Send photos, videos, files | composer.tsx:560-598 → upload, R(sendAttachment) | SPINNER | Ring; bubble after upload | Toast. Staging lost |
| Send contact card | composer.tsx:642 → R(sendContact) | SPINNER | Same ring | Toast. Card lost |
| Mention text after attachments | composer.tsx:577 → R(send) | SPINNER | No local text bubble | Toast |
| Start or cancel voice | composer.tsx:922 | WAIT | Recording UI waits for recorder setup | Toast |
| Send voice | composer.tsx:940 → upload, R(sendAttachment) | WAIT | Controls disable; no ring, no temp | Toast. Take lost |
| Quick Send Later | composer.tsx:964 → R(schedule) | WAIT | No pending indicator | Toast |
| Custom schedule, Save | composer.tsx:1238 → R(schedule) | SPINNER | "Saving…" | Inline error |
| Edit scheduled, Save | scheduled-content.tsx:76 → R(editScheduled) | SPINNER | No list patch | Inline error |
| Cancel scheduled | use-scheduled.ts:39 → R(cancelScheduled) | PARTIAL | Row hides; counts read unpatched `listScheduled({})` | Row restored |
| Send scheduled now | use-scheduled.ts:43 → R(sendScheduledNow) | PARTIAL | Counts lag; thread bubble waits | Row restored, toast |
| Save message edit | composer.tsx:539 → E(edit) | WAIT | Local edit ignored under remote rows | Toast. No rollback |
| Undo send | thread-view.tsx:457 → E(unsend) | WAIT | Same | Toast on enqueue error only |
| Delete for me | thread-view.tsx:474 → E(delete) | WAIT | Same | Toast on enqueue error only |
| Add or remove tapback | thread-view.tsx:391 → E(react) | PARTIAL | Local patch only shows in anchored history | Toast |
| Confirm AI reaction | suggestion-shelf.tsx:145 → R(react) | WAIT | No local reaction | Toast |
| Generate or refresh AI replies | suggestion-shelf.tsx:78 → R(suggestions) | SPINNER | Skeleton after 600 ms | Retry control |
| Accept AI text | suggestion-shelf.tsx:166 | OPTIMISTIC | Fills composer | — |
| Hide AI ghost by typing | composer.tsx:471 | OPTIMISTIC | — | — |
| AI feedback after send | ai-api.ts:40 → E(suggestionFeedback) | WAIT | Background, invisible | Swallowed |
| Draft edit and persist | use-composer-draft.ts:19 → setDraft | OPTIMISTIC | Cloud write delayed | Toast. Local kept |
| Import legacy drafts | use-composer-draft.ts:50 | WAIT | Background | Toast |
| Typing presence | composer.tsx:463 → R(typing) | WAIT | Invisible | Swallowed |
| New chat route, Send | new-chat-content.tsx:114 → R(createChat) | SPINNER | Navigation after receipt | Toast |
| Palette compose, Send | command-palette.tsx:536 → R(createChat) | WAIT | Disabled arrow only | Toast |
| Recipient search | composer.tsx:240, new-chat-content.tsx:74, command-palette.tsx:473 | WAIT | Debounced, no indicator | Silent |
| Recipient chips | new-chat-content.tsx:85 | OPTIMISTIC | — | — |
| Forward to destination | forward-content.tsx:31 → R(send) | WAIT | No pending state | Toast |
| Filter forward targets | use-forward-targets.ts:23 | OPTIMISTIC | — | — |
| Reply or edit mode | thread-view.tsx:410 | OPTIMISTIC | — | — |
| Paste, drop, stage attachment (web) | composer.tsx:655 | OPTIMISTIC | — | Toast on validation |
| Native picker, camera, clipboard | composer.tsx:733 | WAIT | Platform API | Toast |
| Add location | composer.tsx:760 | WAIT | No indicator | Toast |
| Insert mention | composer.tsx:806 | OPTIMISTIC | — | — |

## Triage and conversation state

| Interaction | Handler | Class | Lag or note | Failure shown |
|---|---|---|---|---|
| Settle (⌘E, chip, swipe) | use-triage-actions.ts:60 → E(settle) | PARTIAL | Selection advances; flags and counts wait for the mirror | Toast. Selection not restored |
| Un-settle | use-triage-actions.ts:89 → E(unsettle) | WAIT | Flags wait | Toast |
| Undo triage (toast, ⌘Z) | use-triage-actions.ts:71 → E(unsettle/markRead) | WAIT | Stack pops before the result | Toast |
| Mark read (menu, swipe) | chat-actions.ts:14 → E(markRead) | WAIT | No flag patch | Toast |
| Mark unread (menu, swipe, ⌘U) | chat-actions.ts:18 → E(markUnread) | WAIT | Same | Toast |
| Read on open or inbound | thread-view.tsx:181,250 → E(markRead) | WAIT | Unread dot waits | Swallowed |
| Pin or unpin | chat-actions.ts:10 → E(pin) | WAIT | Switch reads the directory flag | Toast |
| Select, preview, back, panes | messages-workspace.tsx:70 | OPTIMISTIC | — | — |
| Open a thread not yet loaded | use-messages.ts:43 | SPINNER | Skeleton | None |
| Jump to a search hit | use-message-window.ts:16 | SPINNER | Skeleton | None |
| Page older or newer messages | use-messages.ts:74 | WAIT | No paging indicator | Swallowed |
| Directory first load | use-chats.ts:28 | SPINNER | Snapshot can skip it | Offline bar |
| Directory full pagination | use-chats.ts:33 | WAIT | Counts and search grow over pages | None |
| Lenses and refinements (⌘1-4) | conversation-list-pane.tsx:130 | OPTIMISTIC | — | — |
| Save, delete, apply view | saved-views.ts | OPTIMISTIC | — | — |

## Search

| Interaction | Handler | Class | Lag or note | Failure shown |
|---|---|---|---|---|
| Sidebar search | use-conversation-search.ts:64 → searchMessages | PARTIAL | Local hits immediate; deep hits after debounce | Silent |
| Global or scoped history search | search-content.tsx:39 | SPINNER | Old results stay while loading | Empty results |
| Open contact search hit | search-content.tsx:60 → findChat | WAIT | Navigation after lookup | Silent |
| Palette search (⌘K) | command-palette.tsx:127 | PARTIAL | Remote sections lag | Empty results |
| In-thread find (⌘F) | thread-view.tsx:281 | OPTIMISTIC | Loaded rows only | — |

## Conversation details and groups

| Interaction | Handler | Class | Lag or note | Failure shown |
|---|---|---|---|---|
| Open details (phone) | chat-info-content.tsx:101 → chatInfo | SPINNER | Centered spinner | Swallowed |
| Open details (desktop) | same | WAIT | Blank body | Swallowed |
| Rename group | chat-info-content.tsx:135 → E(rename) | WAIT | Name changes on acknowledgement | Toast |
| Add or remove participant | chat-info-content.tsx:144 → R(participant) | WAIT | No pending control | Toast |
| Leave group | chat-info-content.tsx:198 → R(leaveGroup) | WAIT | Close after receipt | Toast |
| Delete conversation | chat-info-content.tsx:176 → R(deleteChat) | WAIT | Navigation after receipt | Toast |

## Contacts and CRM

All identity writes lack an optimistic updater. The visible queries are `whoIs({handle})`, `listPeople({})`, `chatCrm({chatGuids})` and the directory projection.

| Interaction | Handler | Class | Failure shown |
|---|---|---|---|
| Create contact | contacts-add-panel.tsx:49 → createPerson | SPINNER | Toast |
| Attach address to person | contacts-add-panel.tsx:68 → addHandle | WAIT | Toast |
| Airtable search | use-airtable-search.ts:40 | WAIT | Silent |
| Import Airtable contact | use-airtable-search.ts:64 | SPINNER | Toast |
| Edit name, nickname, organization | person-content.tsx:155 → renamePerson | WAIT | Toast |
| Add phone or email | person-content.tsx:354 → addHandle | WAIT | Toast. Draft lost |
| Make primary address | person-content.tsx:374 → setPrimaryHandle | WAIT | Toast |
| Merge duplicates | contacts-merge.tsx:70 → mergePeople | WAIT | Toast |
| Reject duplicate | contacts-merge.tsx:79 → markNotDuplicate | WAIT | Toast |
| Favorite, person or group | person-relationship.tsx:50, chat-crm-section.tsx:53 | WAIT | Toast |
| Priority, person or group | person-relationship.tsx:64, chat-crm-section.tsx:57 | WAIT | Toast |
| Add person tag | person-relationship.tsx:105 → addTag | WAIT | Toast |
| Add group tag | chat-crm-section.tsx:61 → addChatTag | SPINNER | Toast |
| Add group hero tag | chat-info-content.tsx:161 → addChatTag | WAIT | Toast |
| Remove tag | person-relationship.tsx:118, chat-crm-section.tsx:119 | WAIT | Toast |
| Notes | person-relationship.tsx:156 → setNotes | PARTIAL | Toast |
| Event search | crm-events-editor.tsx:31 | SPINNER | Toast |
| Link event | crm-events-editor.tsx:45 → linkEvent | SPINNER | Toast |
| Unlink event | person-relationship.tsx:197 → unlinkEvent | WAIT | Toast |
| Contacts local search | contacts-list-pane.tsx:67 | OPTIMISTIC | — |
| Open person profile | person-content.tsx:60 → whoIs | SPINNER | Crash boundary |

## Settings, media, shell

| Interaction | Handler | Class | Failure shown |
|---|---|---|---|
| Preferences (six dropdowns) | settings-content.tsx:242 | OPTIMISTIC | Silent |
| Clear suggestion learning | settings-content.tsx:186 → R(clearSuggestionLearning) | WAIT | Toast |
| Resize sidebar | sidebar-resize-handle.tsx:16 | OPTIMISTIC | Silent |
| Transcribe audio | media.tsx:60 → R(transcribe) | SPINNER | Inline retry |
| FaceTime link | facetime-button.tsx:46 → R(createFaceTimeLink) | WAIT | Toast |
| FaceTime call | facetime-button.tsx:34 | WAIT | Toast |
| Download or open URL | bubble.tsx:55 | WAIT | None |
| Copy message or crash details | thread-view.tsx:415 | WAIT | Unhandled |
| Retry image | bubble.tsx:170 | SPINNER | "Photo unavailable" |
| Media viewer navigation | lightbox.tsx:56 | OPTIMISTIC | — |
| Gallery and original media | chat-info-content.tsx:74, lightbox.tsx:44 | WAIT | Placeholder |
| Audio or video play | media.tsx:73 | WAIT | None |
| Playback rate | media.tsx:85 | OPTIMISTIC | — |
| Link preview | link-preview-card.tsx:27 | WAIT | Cached null |
| Reload web | release-update-banners.tsx:47 | WAIT | None |
| Restart shell | release-update-banners.tsx:69 | SPINNER | "Restart failed" |
| Help and release disclosures | desktop-shell-provider.tsx:167 | OPTIMISTIC | — |
| Session token refresh | convex-token.ts:8 | WAIT | Null |
| Release polling | deploy-reload.ts:46 | WAIT | Silent |

## Ranked by how often a user feels them

1. Tapbacks. The local patch is discarded in a normal thread, so a reaction waits a full bridge round trip.
2. Settle. The selection moves at once, but flags and lens counts wait for the mirror.
3. Mark read on open, mark unread. The unread dot and counts lag.
4. Pin. The switch and pinned section wait.
5. Voice send and Forward. No pending state at all.
