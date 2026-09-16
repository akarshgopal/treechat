export async function requestAssistantText(
  userText: string,
  quote?: string,
  context?: string,
): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: userText,
        },
      ],
      tools: [],
      context: [],
      forwardedProps: {
        ...(quote ? { quote } : {}),
        ...(context ? { context } : {}),
      },
    }),
  })
  if (!response.ok) {
    throw new Error(`Chat request failed (${response.status})`)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((entry) => entry.startsWith('data:'))
      if (!line) continue
      const payload = line.replace(/^data:\s?/, '').trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const event = JSON.parse(payload) as {
          type?: string
          delta?: string
        }
        if (event.type === 'TEXT_MESSAGE_CONTENT' && event.delta) {
          text += event.delta
        }
      } catch {
        // ignore malformed SSE leftovers
      }
    }
  }

  return text.trim()
}
