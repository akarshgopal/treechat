import { fetchServerSentEvents } from '@tanstack/ai-react'

export const chatConnection = fetchServerSentEvents('/api/chat')
