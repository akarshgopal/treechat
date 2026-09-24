# UI polish TODO

From the UI review (2026-09-24). Tick items off as they land.

## Bugs
- [x] Quotes keep edge punctuation ("…any message," → "…any message").
- [x] Mock replies quote passages with «» while questions use “”.

## System
- [x] One radius scale: 4px (chips, marks), 8px (buttons, fields), 12px (bubbles, dialogs, cards).
- [x] One type scale: 11 / 12 / 13 / 14 / 15px; drop half-pixel sizes.
- [x] One icon button (28px, 36px on touch) instead of five button systems.
- [x] Green means branching: neutral user bubbles, neutral active rows.

## Layout cleanups
- [x] Message actions take no space until hover (desktop); on touch, only on the latest message or via tap.
- [x] Composer: drop the tinted band and top border; the field floats.
- [x] Every lane has a header; the main lane's no longer appears only when a branch opens.
- [x] Desktop: no top bar. Chat title in the main lane header; Documents and the key status live in the sidebar.
- [x] Sidebar: no separate TREE section; a chat's branches nest under it in the chats list, only when it has any.
- [x] Settings: sans preset chips, advanced fields folded, Save at the bottom of what it saves.
- [x] Thin scroll bars, shown on hover or while scrolling.
- [~] Cap a branch's lead offset — dropped: it would undo the levelling asked for earlier; the empty lead is the connector's room.
- [x] Empty chat: prompt and composer centred together; the composer docks once the chat starts.
- [x] One noun per concept in copy: branch (not tangent / side-thread / exploration / pane), takeaway.
- [x] Clearer markdown headings in replies.

## Branching feel
- [x] Branch links under messages become a quiet margin count by the passage.
- [x] The Ask box grows out of the lens bar in place, without jumping or covering the text.
- [x] Opening a branch doesn't steal focus from reading; its connector pulses when the reply is ready.

## Usability
- [x] Lane header: Back, title and Bring back visible; other actions in a ⋯ menu.
- [x] Undo toast instead of confirm dialogs for discarding a branch or deleting a chat.
- [x] Sidebar shows which chats are still replying. (Per branch, in the nested tree: only the open chat's lanes can stream.)
- [x] Web search toggle on the composer, for every thread.
- [x] Command palette (⌘K / Ctrl+K): switch chat, jump to branch, new chat, web search, documents, settings.
- [x] Mobile: swipe right to go back from a branch; lens bar as a bottom sheet; lighter app bar so the title fits (borderless icons, demo note moved to the empty chat).
