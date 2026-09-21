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

1. Open **Settings** (gear in the header).
2. Paste an [OpenRouter](https://openrouter.ai/) API key and optionally a model (default `openai/gpt-4.1-mini`).
3. **Save**. The header switches from `Mock stream` to `Live · openrouter`.
4. **Clear** removes the key from this browser.

Stored under `treechat:provider:v1` in `localStorage`. **Treat the key like a password**: anyone with access to this browser profile can read it, and every chat request sends it from this page to OpenRouter (`Authorization: Bearer …`). TreeChat's GitHub Pages host never sees it.

When a key is set, chat streams from `https://openrouter.ai/api/v1/chat/completions` in the browser (`stream: true`, plus `HTTP-Referer` and `X-Title`). It does **not** call `/api/chat`.

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

1. Select text in a spine message. A **Branch** chip appears (or press **⌘⇧B** / **Ctrl+Shift+B**).
2. Closed branches keep a quiet underline and a gutter pip with the reply count. Hover for a preview; click to open.
3. An open branch is an indented inline thread under the source. Only one inline thread is open at a time.
4. The bottom composer always posts to the spine. While a branch is open, a banner reads **Posting to main · switch to branch**. The branch has its own composer.
5. Branch header: **Drop summary into main**, **Discard** (confirm), **Open as conversation**.
6. Conversation view is a full-frame tangent: Back to spine, quote as context, Drop/Discard. Its composer posts only to that tangent. **Esc** stops an in-flight reply first, then blurs a dirty composer, then returns to the spine.
7. Chats persist in `localStorage` (`treechat:v3`) as a session library: each named chat has its own tree. An older `treechat:v2` single tree (or `treechat:v1` spine) is migrated into one session on first load. The sidebar lists chats; **New chat** opens a blank spine in a **new** session and leaves the others alone. Restore the seeded “What is TreeChat?” demo from Settings — it replaces the **active** chat only (it does not clear the key or other sessions). The OpenRouter key is stored separately (`treechat:provider:v1`).

## Stop, retry, and edit

These act on the **active session’s active thread** (spine or branch), not across chats.

- **Stop** — the composer’s Stop button (while streaming) and **Esc** abort the in-flight mock or OpenRouter stream. Partial text stays; loading UI clears. Abort is not shown as an error.
- **Retry** — hover an assistant message and regenerate from the preceding user turn on that thread. The assistant and everything after it are trimmed, then the turn is resent.
- **Edit** — hover a user message, edit in place, confirm. Later messages on that thread are truncated and the turn is resent.
- **Branches** — child threads pinned to the edited message, or to any truncated message, are **discarded** (anchors would be stale). Nested descendants go with them. Other threads and sessions are untouched.

## Stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui (Button, Textarea, Badge, Tooltip, Separator, AlertDialog, Dialog, ScrollArea)
- TanStack AI: `@tanstack/ai`, `@tanstack/ai-react` (`useChat`), `@tanstack/ai-openai` (OpenAI-compatible local-dev fallbacks)
- GitHub Pages (static) + in-browser OpenRouter BYOK
