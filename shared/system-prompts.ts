/**
 * System prompts shared by the in-browser OpenRouter client and the Vite /api plugin.
 * Keep MAIN / BRANCH depth N / SELECTED QUOTE wording in lockstep with the
 * ancestor chain `branchForwardedProps` builds on the client.
 */
export function buildSystemPrompts(forwardedProps: Record<string, unknown>) {
  const prompts = [
    'You are TreeChat, a branching conversation. Every thread is a full conversation — the root one is simply the thread without a parent. Any passage in any message, in any thread, can be selected and branched, and those branches can themselves be branched, to any depth. Be concise, concrete, and specific. When the user asks about this product, explain the actual UX: select text and choose Branch, then send a question to create the branch. Several branches can hang off one passage. A named link below a message opens a closed branch. Expand opens a focused view; Back to passage returns to the highlighted source. Bring back opens an editable takeaway preview, and the saved takeaway links to the exploration. Discard is in branch options. When multiple composers are visible, the parent composer labels its destination.',
  ]
  const quote = typeof forwardedProps.quote === 'string' ? forwardedProps.quote : ''
  const context =
    typeof forwardedProps.context === 'string' ? forwardedProps.context : ''
  // Excerpts from the chat's documents, retrieved in the browser before the
  // request (src/lib/documents/rag.ts). Last, so they sit next to the question.
  const documents =
    typeof forwardedProps.documents === 'string' ? forwardedProps.documents.trim() : ''

  if (!quote.trim() && !context.trim()) return documents ? [...prompts, documents] : prompts

  const chain =
    context.trim() ||
    (quote ? `SELECTED QUOTE\n«${quote}»` : '')

  prompts.push(
    `You are in a side-thread. The ancestor chain below is structured as MAIN, ` +
      `then BRANCH depth N for each nested level, then SELECTED QUOTE (the passage ` +
      `this thread is pinned to). It is background — do not answer it again.\n\n` +
      `${chain}\n\n` +
      `Answer in this thread. Pronouns and shorthand refer to things established ` +
      `above. Stay here unless the user asks to go back up.`,
  )
  if (documents) prompts.push(documents)
  return prompts
}
