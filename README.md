# TreeChat

A branching LLM chat. The main thread is the **spine**. Select a passage in any message to grow a **side-thread** anchored to that character range and quote — then drop a summary back onto the trunk, discard the tangent, or open it as its own conversation.

Built with Vite, React, TypeScript, Tailwind CSS, shadcn/ui, and TanStack AI (`useChat`). Production is a **static GitHub Pages** app: paste an **OpenRouter API key** in Settings (gear). The key stays in `localStorage` and the browser calls OpenRouter directly (BYOK). With no key, a polished mock stream keeps the whole UX clickable — including on Pages, with no API server.

## Setup

```bash
pnpm install
pnpm dev
```

Open the printed local URL (Vite defaults to http://localhost:5173).

```bash
pnpm build      # production bundle → dist/
pnpm preview    # serve the build (Vite plugin still handles /api/chat for mock / env fallbacks)
```

## Bring your own key (OpenRouter)

1. Open **Settings** (bottom of the sidebar; the gear in the header on phones).
2. Paste an [OpenRouter](https://openrouter.ai/) API key and optionally a model (default `openai/gpt-4.1-mini`).
3. **Save**. The header's `Demo replies · Add key` notice disappears.
4. **Remove key** forgets the key in this browser; the model and generation params stay saved.

Stored under `treechat:provider:v1` in `localStorage`. **Treat the key like a password**: anyone with access to this browser profile can read it, and every chat request sends it from this page to OpenRouter (`Authorization: Bearer …`). TreeChat's GitHub Pages host never sees it.

When a key is set, chat streams from `https://openrouter.ai/api/v1/chat/completions` in the browser (`stream: true`, plus `HTTP-Referer` and `X-Title`). It does **not** call `/api/chat`.

While waiting for the first visible token, the thread shows elapsed waiting time. Provider errors, including errors delivered inside an HTTP 200 stream, are displayed with a retry action.

Requests in one chat share an OpenRouter `session_id` to support sticky provider routing. Prompt caching remains provider/model dependent and requires a matching prefix; this does not guarantee cache hits or a specific response time. See [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching).

## Mock mode (no key)

- **GitHub Pages:** the mock stream runs entirely in the browser. There is no `/api/chat`.
- **Local `pnpm dev` / `pnpm preview`:** the Vite plugin still serves `/api/chat` (mock, or a live env-key fallback if you set one). If that plugin is absent, the same in-browser mock is used.

## Environment variables

Copy `.env.example` to `.env`. Production BYOK is client-side; these keys are **optional local fallbacks** for `pnpm dev` / `pnpm preview` only. Leave every key blank to run in **mock** mode.

| Variable | Purpose |
| --- | --- |
| `XAI_API_KEY` | SpaceXAI / xAI fallback. Server calls `https://api.x.ai/v1`. |
| `XAI_MODEL` | Defaults to `grok-4.6`. |
| `OPENAI_API_KEY` | Used if `XAI_API_KEY` is unset. |
| `OPENAI_MODEL` | Defaults to `gpt-4.1-mini`. |
| `OPENROUTER_API_KEY` | Used if neither xAI nor OpenAI is set. |
| `OPENROUTER_MODEL` | Defaults to `openai/gpt-4.1-mini`. |
| `VITE_BASE` | Public path. Defaults to `/` locally. In GitHub Actions, `GITHUB_REPOSITORY` (`akarshgopal/treechat`) sets `/treechat/`. Use `VITE_BASE=/` for a user/org site at the domain root. |

Do not prefix provider keys with `VITE_`. A Settings OpenRouter key always wins over env.

## Deploy to GitHub Pages

The app is a static `dist/` site. Hosting is GitHub Pages (no Cloudflare Pages Functions).

Project site URL: `https://akarshgopal.github.io/treechat/` (Vite `base` `/treechat/`).

1. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the **Deploy GitHub Pages** workflow). `.github/workflows/pages.yml` runs `pnpm test`, `pnpm build`, and uploads `dist`.
3. Vite base is `/treechat/` when `GITHUB_REPOSITORY` is `*/treechat`. Override with `VITE_BASE=/` for `https://<user>.github.io/`.
4. Local production build meant for Pages: `VITE_BASE=/treechat/ pnpm build`.

No secrets belong in the workflow. Users paste OpenRouter keys in Settings.

## How branching works

1. **Downward is time, rightward is depth.** Every thread on the open path gets a full-height lane with its own composer. A branch starts level with the passage it grew from (sliding up only as far as it needs to stay fully visible), and a line in the gutter ties the two together as they scroll. Drag a gutter (or focus it and use ←/→) to resize the lane to its right; double-click resets it. Lanes fold into narrow strips with the fold button in their header, and ancestors fold automatically when they no longer fit; click a strip to expand it. Phones show one lane at a time.
2. **Branch in one gesture.** Select a passage and a bar appears at the selection: **Explain · Example · Source? · Challenge · Simpler · Deeper** start a branch in one tap. **Ask…**, **⌘⇧B / Ctrl+Shift+B**, or simply typing opens a question box right there; the passage stays highlighted while you write. Selections snap to whole words. The branch icon below a message asks about the whole message.
3. The new branch opens in the lane to the right and its first reply starts immediately. Esc or Cancel on an unsent question leaves no branch behind.
4. **Back** (the arrow in a branch header) closes that lane and highlights the source. Clicking an underlined passage or its "↳" link opens or closes its branch. Reading positions and drafts are kept per thread while you move around and switch chats in the current app visit; drafts are not saved across reloads.
5. **Bring back** prepares an editable takeaway preview. **Add takeaway** appends it to the parent conversation, scrolls to and highlights it, and preserves the branch. **View exploration** on the takeaway reopens the branch; **Undo** in the confirmation banner removes only the takeaway. If generation fails, retry or write the takeaway yourself.
6. The tree rail names branches from their first question. The trash button in a branch header asks for confirmation before removing a subtree. A ✓ in the tree marks branches whose takeaway was brought back.
7. **Esc** closes a question box or dialog first. Otherwise it stops an in-flight reply, dismisses a selection, blurs a dirty branch composer, or closes the rightmost lane, in that order.
8. **Edit** and **Retry** rewrite a conversation from that point. If that would remove more than the reply being regenerated — later turns or branches anchored below — TreeChat asks first.
9. The sidebar holds **New chat**, the tree, your chats, **Documents**, and **Settings**. Collapse it to an icon strip with its toggle or **Ctrl/⌘+\\**, and drag its right edge to resize it; both are remembered in this browser.
10. Chats persist in `localStorage` (`treechat:v3`) as a session library. Older `treechat:v2` trees and `treechat:v1` spines are migrated on load. **New chat** creates a separate session, or reuses one that is still blank. On phones, the chat switcher in the header also lists the current chat's branches. Restore the seeded demo from Settings to replace only the active chat; other sessions and provider settings stay intact.

## Documents

Ask about your own files. Add PDFs, Markdown, or plain text from **Documents** in the sidebar (on phones, the chat switcher in the header), from the **Documents** chip in the header, or by dropping files anywhere on the app. The library is shared by all chats; each chat searches only the documents checked for it, and a file added from a chat is checked for that chat.

- **Indexing** runs in the browser: text is extracted (PDFs keep page numbers, Markdown keeps headings), split into ~800-character chunks with overlap, embedded, and stored in IndexedDB (`treechat-documents`).
- **Embeddings** come from [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (quantized) running in a Web Worker via transformers.js. The first document downloads the model once (~23 MB from Hugging Face, plus the ~7 MB compressed ONNX runtime from jsDelivr); the browser caches both. If the model cannot load (offline on first use, no WebAssembly), documents fall back to keyword search and say so.
- **Before each request** in a chat with documents, the latest question (plus a branch's quoted passage) is matched against the chunks. Up to five excerpts are added to the system prompt, numbered `[1]`…`[5]` with the file name and page or heading, and the model is asked to cite them. The reply stores those sources as citations. Demo replies list the matching excerpts instead.
- **Privacy:** files, extracted text, and vectors never leave this browser. Only the retrieved excerpts are sent, with your question, to whichever model answers it (OpenRouter, or the local `/api/chat` in development).
- Removing a document deletes it and its chunks and unchecks it in every chat. Citations already on replies stay.

## Browser verification

```bash
pnpm exec playwright install chromium   # once, unless using an existing Chromium
pnpm test:e2e
```

Playwright builds the production app and serves it on `127.0.0.1:5180`. A second Vite server on `127.0.0.1:5190` verifies branch requests under development StrictMode. Tests cover desktop and mobile Chromium, settings-key branch and nested-branch context, user-message regeneration, delayed responses and stream errors, branch cancellation and creation, reply destinations, takeaway review and undo, failed generation, source-link persistence, drafts across chats, and documents (add, attach, cited retrieval, remove). Provider requests are intercepted; no real API keys or model calls are used, and documents use a deterministic fake embedder (`localStorage["treechat:fake-embedder"] = "1"`) instead of downloading the model.

Set `CHROME_PATH=/absolute/path/to/chromium` to use an existing browser. Screenshots are written to `test-results/`; failed runs also retain Playwright traces. `node verify-treechat.mjs` runs the same suite.

## Stop, retry, and edit

These act on the **active session’s active thread** (spine or branch), not across chats.

- **Stop** — the composer’s Stop button (while streaming) and **Esc** abort the in-flight mock or OpenRouter stream. Partial text stays; loading UI clears. Abort is not shown as an error.
- **Retry** — hover an assistant message and regenerate from the preceding user turn on that thread. The assistant and everything after it are trimmed, then the turn is resent.
- **Regenerate response** — available on user messages, including unanswered ones. Resends that turn and replaces later replies while preserving branches anchored to the unchanged user message.
- **Edit** — hover a user message, edit in place, confirm. Later messages on that thread are truncated and the turn is resent.
- **Branches** — child threads pinned to the edited message, or to any truncated message, are **discarded** (anchors would be stale). Nested descendants go with them. Other threads and sessions are untouched.

## Stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui (Button, Textarea, Badge, Tooltip, Separator, AlertDialog, Dialog, ScrollArea)
- TanStack AI: `@tanstack/ai`, `@tanstack/ai-react` (`useChat`), `@tanstack/ai-openai` (OpenAI-compatible local-dev fallbacks)
- GitHub Pages (static) + in-browser OpenRouter BYOK
