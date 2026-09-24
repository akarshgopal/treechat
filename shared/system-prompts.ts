/**
 * System prompts shared by the in-browser OpenRouter client and the Vite /api plugin.
 * Keep MAIN / BRANCH depth N / SELECTED QUOTE wording in lockstep with the
 * ancestor chain `branchForwardedProps` builds on the client.
 */
export const SUMMARY_SECTION = 'SUMMARY OF EARLIER CONVERSATION'

export function buildSystemPrompts(forwardedProps: Record<string, unknown>) {
  const prompts = [
    'You are TreeChat, a branching conversation. Every thread is a full conversation — the root one is simply the thread without a parent. Any passage in any message, in any thread, can be selected and branched, and those branches can themselves be branched, to any depth. Be concise, concrete, and specific. When the user asks about this product, explain the actual UX: select text and a bar appears at the selection with one-tap questions (Explain, Example, Source?, Challenge, Simpler, Deeper) or Ask… to type your own. Each branch opens in its own lane to the right, level with its passage, with its own composer. Several branches can hang off one passage; a dot in the margin beside the passage opens or closes them. The back arrow closes a branch and highlights its source. Bring back opens an editable takeaway preview, and the saved takeaway links to the branch. Source? branches search the web and cite sources, chats can use attached documents, the globe beside the composer turns on web search for any thread, Ctrl/⌘+K opens a command palette, and Discard branch (in the branch’s ⋯ menu, with Undo) removes a branch.',
  ]
  const quote = typeof forwardedProps.quote === 'string' ? forwardedProps.quote : ''
  const context =
    typeof forwardedProps.context === 'string' ? forwardedProps.context : ''
  const summary =
    typeof forwardedProps.summary === 'string' ? forwardedProps.summary.trim() : ''
  // After the branch chain: the summary changes only every few thousand
  // tokens, so everything above it stays a cacheable prefix.
  const summaryPrompt = summary
    ? `${SUMMARY_SECTION}\n${summary}\n\nThe messages that follow continue this ` +
      `conversation from where the summary ends.`
    : null
  // Excerpts from the chat's documents, retrieved in the browser before the
  // request (src/lib/documents/rag.ts). Last, so they sit next to the question.
  const documents =
    typeof forwardedProps.documents === 'string' ? forwardedProps.documents.trim() : ''
  const tail = [summaryPrompt, documents].filter((prompt): prompt is string => Boolean(prompt))

  if (!quote.trim() && !context.trim()) return [...prompts, ...tail]

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
  prompts.push(...tail)
  return prompts
}
