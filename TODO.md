# Pre-release TODO

What to do before sharing TreeChat publicly (2026-09-24). Tick items off as they land.

## Must fix
- [x] 1. **No silent data loss.** A full localStorage (~5 MB) quietly drops the oldest chats to make the save fit, and a 41st chat silently deletes the oldest one. Warn instead, keep every chat, and offer Export.
  - Follow-up: move the chat library to IndexedDB (documents and attachments already live there) so the ~5 MB ceiling goes away.
- [x] 2. **Error screen.** A render error currently leaves a blank page. Catch it and show Reload, Export my chats, the error details and a report link.
- [x] 3. **API key exposure.** The key lives in localStorage for the site's origin; on `*.github.io` every Pages site of the account shares that origin. Tell people in Settings to use a key with a credit limit.
  - Owner follow-up: serve from a custom domain so no other site shares the origin.
- [x] 4. **Privacy note.** Say where data goes: OpenRouter (and free models that may log prompts), r.jina.ai for cited pages, Hugging Face and jsDelivr for the embedding model. Self-host the fonts instead of Google Fonts.
- [x] 5. **Web search costs.** Source? turns on web search, which costs extra per search with a key. Say so on the toggle and the first time it happens.

## Should fix
- [ ] 6. Real-key smoke test by hand: streaming, web-search citation numbering, the image-model check, free background models and fallback, long-thread summaries.
- [ ] 7. Check the preset model ids still exist on OpenRouter and are sensible defaults.
- [x] 8. **Smaller deploy.** Drop the unused 27 MB ONNX runtime from `dist`; split the ~1 MB main bundle (pdf.js, markdown, highlighting) so phones load faster.
  - Done: the deploy went from 29 MB to 4.1 MB, and highlight.js (~170 KB) now loads with the first code block. The main script is still ~890 KB (React, TanStack AI, markdown); splitting further is a follow-up.
- [x] 9. **Playwright in CI.** The Pages workflow runs the e2e suite (Chromium, one retry) before building; a failure blocks the deploy and uploads the report and traces.
- [x] 10. **Export and import chats** as JSON.
- [ ] 11. Browser check: Safari and Firefox (selection, CSS Custom Highlight API, the iOS bottom sheet).

## Presentation
- [x] 12. **Page metadata:** current description, Open Graph and Twitter tags, a social preview image, theme colour.
- [ ] 13. Add a LICENSE if the repo is public.
- [x] 14. **Tidy the repo:** remove the leftover `verify-treechat.mjs`.
- [x] 15. **README:** screenshot, live link, known limits (scanned PDFs have no OCR, documents fall back to keyword search after an embedder change, data stays in the browser).
- [x] 16. **Report a problem** link to GitHub issues.
