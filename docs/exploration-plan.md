# Exploration features: plan and handoff

Goal: make TreeChat better for curiosity-driven, branching conversations. This
file hands the work to a fresh session. The agreed design is in the mockup:

- Live mockup (owner's link, private): https://claude.ai/artifact/Wdr3XHjQKBAe7MDx3zDsc3
- Source of the mockup: `docs/exploration-mockup.dc.html`. It is a Design
  Component file for the claude.ai canvas, not app code. Read the markup and the
  `class Component` logic at the bottom for behaviour and copy.

## Decisions from the owner

- **Keep the UI minimal.** No bells and whistles, explanatory helper text,
  extra toggles or options. When in doubt, leave it out.
- **No branch states.** Open, resolved and dead end were tried and rejected.
  The only marker is an unread dot for a branch with an answer not yet seen.
- **Branches always carry context.** There is no "with context / fresh"
  switch and no "what this branch sees" peek.
- **No suggested branches.**
- **No side-by-side compare** for answers. A pager is enough.
- **No "ask in background" button** and no inbox list. The dots are enough.
- Green is used only for branching and "new".

## The four features

Each can be built on its own branch off main, then merged. The expected
overlaps are small:

- `src/types.ts`: optional fields.
- `TreeChatApp.tsx` and `LaneHeader.tsx`: small wiring.

### 1. Branch from anything (`feat/branch-from-anything`)

- **Source lanes.** Text in a `SourceLane` (cited web pages and documents) can
  be selected and branched like message text. It uses the same selection chip
  and `BranchPopover` flow.
  - Extend `Anchor` minimally, with an optional source descriptor for the
    citation or document and its locator.
  - Context includes the quote plus a bounded amount of the surrounding
    source text.
  - The anchor label shows "From <doc title>".
- **Sidebar documents.** Clicking a document in the sidebar Documents section
  opens it as a read-only source lane beside the chat, where its text can be
  branched from.
- **Image regions.**
  - An image attachment gets a "Select a region" affordance: drag a rectangle,
    by pointer or touch, then go through the normal branch question flow.
  - The anchor stores the attachment id and a normalized rect.
  - The first request sends the cropped region as an image attachment.
  - A crop thumbnail is shown as the branch's anchor.
- **Your own question.** Check that branching from your own question works:
  user messages are already selectable.
- **Markers.** Show margin markers for branches anchored to an image or source
  where that's feasible.

### 2. Unread dots and "Explored before" (`feat/unread-explored`)

**Unread.**
- When a reply finishes in a thread the user isn't looking at, set
  `Thread.unread?: true`. Replies can finish there because streams run outside
  the open chat: see `thread-runs.tsx` and `thread-run-registry.ts`.
- Show a small green dot and a bold title on the thread's row in the sidebar
  tree, and on the chat's row when any of its threads is unread.
- Opening the thread clears the flag.
- Export `unreadCount(tree)` from `src/lib/unread.ts`. The Map button badge
  "N new" uses it.

**Explored before.**
- Show one compact line above the input: "Explored before: <title>".
  - Include where it was: this chat, or the other chat's title.
  - Add a muted, single-line takeaway if the branch has one.
  - End the line with **Open** and a dismiss ×. Show at most two matches.
- It appears in `BranchPopover` straight away when the selected passage
  overlaps an existing branch's anchor, and in both the popover and
  `Composer` as the user types.
- Matching runs offline across all chats: normalize, drop stopwords, and
  compare significant-term overlap with each branch's title, first question
  and quote. Put it in a pure `src/lib/explored.ts` with unit tests.

### 3. Map, "What did I learn?" and Share (`feat/map-learn-share`)

The main lane header gets **Map** (with an "N new" badge), **What did I
learn?**, and a share icon. Share can go in the ⋯ menu if the header is too
crowded on mobile.

**Map.** A full-screen overlay:
- The root card sits on top and the level-1 branches form a row of cards below
  it. Descendants nest vertically under each card with a thin rule.
- A card shows the title, the quote in muted italics, and the takeaway if
  there is one. The takeaway is the latest `drop-summary` in the parent with
  `sourceThreadId`.
- The current thread is highlighted. Clicking a card jumps to it and Esc
  closes the map.
- On mobile it's a single column.

**What did I learn?** A right-side drawer:
- It streams a Markdown summary through `requestAssistantText` with
  `background: true` and `onText`, as `TakeawayDialog` does.
- The scope is the whole chat on Main, and the active branch plus its subtree
  otherwise.
- The output is a lead paragraph, "## Takeaways", and "## Also explored".
- It's read-only while streaming and editable afterwards.
- The buttons are Copy and Download .md. Handle errors like `TakeawayDialog`.
- Add a deterministic path to `craftReply` in `shared/mock-stream.ts` for the
  no-key demo.

**Share.** One click downloads a single read-only HTML file of the whole
tree:
- Inline dark CSS, no external requests, no scripts. Use `<details>` for
  nesting.
- Escape everything. Links are http(s) only, with `noopener noreferrer`. No
  remote images.
- Build it in a pure `src/lib/share-html.ts`, with unit tests.

### 4. Alternative answers (`feat/sibling-answers`)

- **Regenerate** keeps the previous answer as a sibling on the assistant
  message, for example `alternates?: [...]`. `content` stays the current
  answer. Context, takeaways and summaries use only the current answer.
- **Pager.** Show "‹ 2 of 3 · model ›" under a reply that has siblings.
  - Switching must not corrupt branch anchors. Either show markers only where
    the quote is found, or block switching away from an answer that has
    branches.
  - Switching is only allowed on the last message, matching what regenerate
    already allows.
- **Try another model.** A message action on the latest reply lists the preset
  main models from `src/lib/provider.ts` except the current one, plus an
  optional "Other…" that uses `ModelPicker`.
  - The chosen model is a per-request override through `client-chat`; the
    Settings model doesn't change.
  - The new answer becomes the current one.
- Import and export must round-trip siblings.

## Ground rules (all features)

- Old saved data must keep loading. New fields are optional. Import and export
  in `src/lib/transfer.ts` must round-trip them.
- Tests must never contact real providers. `tests/e2e/fixtures.ts` blocks
  outside traffic; use `page.route` or the mock backend, and never use real
  keys. `.env` holds real keys: never read or use it.
- Before merging, all of these must pass:
  - `npm run lint`, with only the 2 existing warnings;
  - `npm test`;
  - `npx playwright test`.
- Add unit tests for pure logic and end-to-end tests for each flow.
- Commit and push only when the owner asks. Merge each feature branch into
  main after its checks pass.

## Status

All four features are built on `plan/exploration`, one commit each, with unit
tests for the pure logic and an e2e spec per feature:

- Branch from anything: `src/lib/anchors.ts`, `tests/e2e/branch-from-anything.spec.ts`.
- Unread and Explored before: `src/lib/unread.ts`, `src/lib/explored.ts`,
  `tests/e2e/unread-explored.spec.ts`.
- Map, What did I learn? and Share: `src/lib/learn.ts`, `src/lib/share-html.ts`,
  `tests/e2e/map-learn-share.spec.ts`.
- Alternative answers: `src/lib/alternates.ts`, `tests/e2e/sibling-answers.spec.ts`.

Choices worth knowing:

- A document opened from the sidebar hangs its branches off the open thread's
  latest message, so they carry that conversation as context. It has no
  margin marker in the message; the document lane shows its branches.
- Cited-page branches get their margin marker at the citation in the reply.
- Switching answers is blocked away from an answer that has branches, and on
  any reply but the latest. Regenerate and Try another model still ask
  before dropping branches on the reply they replace, as before.
- On phones, Map sits in the app bar and What did I learn? and Share in its
  ⋯ menu.

Not merged into main: that is the owner's call.
