import { collectAssistantText, runChat } from './client-chat.ts'
import { backgroundModelFor, loadProviderConfig } from './provider.ts'

export type AssistantRequestOptions = {
  /** Background work (summaries, takeaway drafts): try the background model first. */
  background?: boolean
}

export async function requestAssistantText(
  userText: string,
  quote?: string,
  context?: string,
  signal?: AbortSignal,
  options: AssistantRequestOptions = {},
): Promise<string> {
  const content = userText
  const run = (model?: string) => collectAssistantText(
    runChat({
      signal,
      threadId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      model,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content,
          parts: [{ type: 'text', content }],
        },
      ],
      forwardedProps: {
        quote: quote ?? '',
        context: context ?? '',
      },
    }),
  )

  const background = options.background ? backgroundModelFor(loadProviderConfig()) : undefined
  if (!background) return run()
  try {
    const text = await run(background)
    if (text) return text
  } catch (error) {
    if (signal?.aborted) throw error
  }
  // Free background models are rate limited (429) and come and go; the main
  // model is the one the person already knows works.
  return run()
}
