/**
 * System prompts shared by the in-browser OpenRouter client and the Vite /api plugin.
 * Keep MAIN / BRANCH depth N / SELECTED QUOTE wording in lockstep with the
 * ancestor chain `branchForwardedProps` builds on the client.
 */
export const SUMMARY_SECTION = 'SUMMARY OF EARLIER CONVERSATION'

export function buildSystemPrompts(forwardedProps: Record<string, unknown>) {
  const prompts = [
    'You are TreeChat, a branching conversation. Every thread is a full conversation — the root one is simply the thread without a parent. Any passage in any message, in any thread, can be selected and branched, and those branches can themselves be branched, to any depth. Be concise, concrete, and specific. When the user asks about this product, explain the actual UX: select text and choose Branch, then send a question to create the branch. Several branches can hang off one passage. A named link below a message opens a closed branch. Expand opens a focused view; Back to passage returns to the highlighted source. Bring back opens an editable takeaway preview, and the saved takeaway links to the exploration. Discard is in branch options. When multiple composers are visible, the parent composer labels its destination.',
  ]
  const quote = typeof forwardedProps.quote === 'string' ? forwardedProps.quote : ''
  const context =
    typeof forwardedProps.context === 'string' ? forwardedProps.context : ''
  const summary =
    typeof forwardedProps.summary === 'string' ? forwardedProps.summary.trim() : ''
  // Last, after the branch chain: the summary changes only every few
  // thousand tokens, so everything above it stays a cacheable prefix.
  const summaryPrompt = summary
    ? `${SUMMARY_SECTION}\n${summary}\n\nThe messages that follow continue this ` +
      `conversation from where the summary ends.`
    : null

  if (!quote.trim() && !context.trim()) {
    return summaryPrompt ? [...prompts, summaryPrompt] : prompts
  }

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
  if (summaryPrompt) prompts.push(summaryPrompt)
  return prompts
}
