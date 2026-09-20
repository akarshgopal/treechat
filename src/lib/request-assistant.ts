import { collectAssistantText, runChat } from './client-chat.ts'

export async function requestAssistantText(
  userText: string,
  quote?: string,
  context?: string,
): Promise<string> {
  const content = userText
  return collectAssistantText(
    runChat({
      threadId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
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
}
