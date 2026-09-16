# TreeChat

A branching LLM chat. The main thread is the **spine**. Select a passage in any message to grow a **side-thread** anchored to that character range and quote — then drop a summary back onto the trunk, discard the tangent, or open it as its own conversation.

Built with Vite, React, TypeScript, Tailwind CSS, shadcn/ui, and TanStack AI (`useChat`). API keys stay on a thin Vite `/api/chat` route. With no key, a polished mock stream keeps the whole UX clickable offline.

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL (Vite defaults to http://localhost:5173).

```bash
npm run build    # production bundle
npm run preview  # serve the build (API plugin still handles /api/chat)
```

## Environment variables

Copy `.env.example` to `.env`. Leave every key blank to run in **mock** mode.

| Variable | Purpose |
| --- | --- |
| `XAI_API_KEY` | SpaceXAI / xAI key (preferred). Server calls `https://api.x.ai/v1`. |
| `XAI_MODEL` | Defaults to `grok-4.6`. |
| `OPENAI_API_KEY` | Used if `XAI_API_KEY` is unset. |
| `OPENAI_MODEL` | Defaults to `gpt-4.1-mini`. |
| `OPENROUTER_API_KEY` | Used if neither xAI nor OpenAI is set. |
| `OPENROUTER_MODEL` | Defaults to `openai/gpt-4.1-mini`. |

Do not prefix these with `VITE_`. The client never sees the key.

## How branching works

1. Select text in a spine message. A **Branch** chip appears (or press **⌘⇧B** / **Ctrl+Shift+B**).
2. Closed branches keep a quiet underline and a gutter pip with the reply count. Hover for a preview; click to open.
3. An open branch is an indented inline thread under the source. Only one inline thread is open at a time.
4. The bottom composer always posts to the spine. While a branch is open, a banner reads **Posting to main · switch to branch**. The branch has its own composer.
5. Branch header: **Drop summary into main**, **Discard** (confirm), **Open as conversation**.
6. Conversation view is a full-frame tangent: Back to spine, quote as context, Drop/Discard. Its composer posts only to that tangent. **Esc** blurs a dirty composer first, then returns to the spine.
7. Branches and view mode persist in `localStorage` (`treechat:v1`). Use the header reset control to restore the seeded demo.

## Stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui (Button, Textarea, Badge, Tooltip, Separator, AlertDialog, Dialog, ScrollArea)
- TanStack AI: `@tanstack/ai`, `@tanstack/ai-react` (`useChat`), `@tanstack/ai-openai` (OpenAI + OpenAI-compatible xAI / OpenRouter)
