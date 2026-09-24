# UI polish TODO

From the UI review (2026-09-24). Tick items off as they land.

## Bugs
- [x] Quotes keep edge punctuation ("…any message," → "…any message").
- [x] Mock replies quote passages with «» while questions use “”.

## System
- [ ] One radius scale: 4px (chips, marks), 8px (buttons, fields), 12px (bubbles, dialogs, cards).
- [ ] One type scale: 11 / 12 / 13 / 14 / 15px; drop half-pixel sizes.
- [ ] One icon button (28px, 36px on touch) instead of five button systems.
- [ ] Green means branching: neutral user bubbles, neutral active rows.

## Layout cleanups
- [ ] Message actions take no space until hover (desktop); on touch, only on the latest message or via tap.
- [ ] Composer: drop the tinted band and top border; the field floats.
- [ ] Every lane has a header; the main lane's no longer appears only when a branch opens.
- [ ] Desktop: no top bar. Chat title in the main lane header; Documents and the key status live in the sidebar.
- [ ] Sidebar: no separate TREE section; a chat's branches nest under it in the chats list, only when it has any.
- [ ] Settings: sans preset chips, advanced fields folded, Save at the bottom of what it saves.
- [ ] Thin scroll bars, shown on hover or while scrolling.
- [ ] Cap a branch's lead offset so short branches don't start halfway down an empty lane.
- [ ] Empty chat: prompt and composer centred together; the composer docks once the chat starts.
- [ ] One noun per concept in copy: branch (not tangent / side-thread / exploration / pane), takeaway.
- [ ] Clearer markdown headings in replies.

## Branching feel
- [ ] Branch links under messages become a quiet margin count by the passage.
- [ ] The Ask box grows out of the lens bar in place, without jumping or covering the text.
- [ ] Opening a branch doesn't steal focus from reading; its connector pulses when the reply is ready.

## Usability
- [ ] Lane header: Back, title and Bring back visible; other actions in a ⋯ menu.
- [ ] Undo toast instead of confirm dialogs for discarding a branch or deleting a chat.
- [ ] Sidebar shows which chats are still replying.
- [ ] Web search toggle on the composer, for every thread.
- [ ] Command palette (⌘K / Ctrl+K): switch chat, jump to branch, new chat, web search, documents, settings.
- [ ] Mobile: swipe right to go back from a branch; lens bar as a bottom sheet; header actions in a menu so the title fits.
