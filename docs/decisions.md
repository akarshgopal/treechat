# Decisions and ground rules

What was decided while building TreeChat and still holds, so the reasons
aren't lost. Each point says what the code does; the code says how.

## Product

- **Keep the UI minimal.** No explanatory helper text, extra toggles or
  options. When in doubt, leave it out.
- **No branch states.** Open, resolved and dead end were tried and rejected.
  The only marker is an unread dot for a branch with a reply not yet seen.
- **Branches always carry context.** There is no "with context / fresh" switch
  and no "what this branch sees" peek.
- **No suggested branches**, no side-by-side compare of answers (a pager is
  enough), and no "ask in background" button or inbox (the dots are enough).
- **Green is only for branching and "new".**

## How the features behave

- **Branch from anything.** Text in a source lane (a cited page, or a
  document opened from the sidebar) branches like message text. Such anchors
  keep their offsets in `anchor.source.start/end`, with 0–0 message offsets,
  so nothing in the message is underlined. An image region's anchor also has
  0–0 offsets; its crop is stored as its own attachment and sent with the
  branch.
- **Sidebar documents** anchor their branches to no message
  (`messageId: ''`). Their context is the thread up to its last message when
  the branch was made (`source.throughMessageId`), and rewriting a reply never
  touches them. The document's lane shows them; they have no margin marker.
  A cited page's branches get their marker at the citation in the reply.
- **Unread** follows what is actually on screen: full lanes only (not folded
  strips, not ancestors hidden on a phone), and nothing while the tab is
  hidden.
- **Alternative answers.** Switching is allowed only on the latest reply, and
  never away from an answer that has branches, so anchors stay true.
  Regenerate and Try another model still ask before dropping branches on the
  reply they replace. A regenerate saves the replaced answers on the thread
  (`pendingAnswers`) until its run ends: a failure, a stop before any text,
  or a page closed mid-reply puts the reply back with all its answers.
- **What did I learn?** in the main header covers the whole chat; each
  branch's ⋯ menu has its own, for that branch and what grew from it. On
  phones (one lane) it covers the lane being read. The drawer names its scope.
- **On phones**, Map sits in the app bar, and What did I learn? and Share in
  its ⋯ menu.
- **Run hand-offs** (sources, cost, a model override) are keyed by chat and
  thread (`src/lib/run-key.ts`): every chat's main thread has the same id.

## Data

- Old saved data must keep loading. New fields are optional, and import and
  export (`src/lib/transfer.ts`) round-trip them.
- Rolling back to a version before the exploration features (`1492b80`) is
  safe: it loads newer saved chats and exports, keeps every branch and drops
  the fields it doesn't know. A reply keeps only its current answer there.

## Tests

- Tests never contact real providers or use real keys. `tests/e2e/fixtures.ts`
  blocks outside traffic; fake endpoints with `page.route` or rely on the demo
  stream. `.env` may hold real keys: never read or use it.
- Unit tests for pure logic, an end-to-end test for each flow.
- Before merging: `npm run lint` (only its one standing warning), `npm test`
  and `npx playwright test` pass.
- The `development` Playwright project runs `branch-request.spec.ts` against
  the dev server on purpose: dev mode runs React StrictMode, which mounts the
  chat engine twice, and that has broken sending before.

## Before a release, by hand

- **With a real OpenRouter key:** streaming, web-search citation numbering,
  Try another model, a region branch sent to a vision model, What did I learn?
  with a free background model and its fallback, and long-thread summaries.
- **On real devices:** long-press selection and the on-screen keyboard over
  the lens sheet in iOS Safari, and dragging an image region on iOS and
  Android. The e2e suite covers these only with an emulated phone and
  synthetic touch.
- **Hosting:** serving from a custom domain would stop other `*.github.io`
  sites of the same account sharing the origin (and so the saved key).
