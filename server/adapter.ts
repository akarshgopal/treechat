import { createOpenaiChatCompletions } from '@tanstack/ai-openai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'

export type ProviderId = 'xai' | 'openai' | 'openrouter' | 'mock'

export type ProviderStatus = {
  mode: 'mock' | 'live'
  provider: ProviderId
  model: string
}

export function getProviderStatus(): ProviderStatus {
  if (process.env.XAI_API_KEY) {
    return {
      mode: 'live',
      provider: 'xai',
      model: process.env.XAI_MODEL || 'grok-4.6',
    }
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      mode: 'live',
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    }
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      mode: 'live',
      provider: 'openrouter',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini',
    }
  }
  return { mode: 'mock', provider: 'mock', model: 'treechat-mock' }
}

export function getTextAdapter() {
  const status = getProviderStatus()
  if (status.provider === 'xai') {
    return openaiCompatibleText(status.model, {
      name: 'xai',
      apiKey: process.env.XAI_API_KEY!,
      baseURL: 'https://api.x.ai/v1',
      api: 'chat-completions',
    })
  }
  if (status.provider === 'openai') {
    return createOpenaiChatCompletions(
      status.model as 'gpt-4.1-mini',
      process.env.OPENAI_API_KEY!,
    )
  }
  if (status.provider === 'openrouter') {
    return openaiCompatibleText(status.model, {
      name: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: 'https://openrouter.ai/api/v1',
      api: 'chat-completions',
    })
  }
  return null
}

export function buildSystemPrompts(forwardedProps: Record<string, unknown>) {
  const prompts = [
    'You are TreeChat, a branching conversation assistant. The main thread is the spine; side-threads are branches anchored to a quoted character range. Be concise, concrete, and specific. When the user asks about this product, explain the actual UX: select text to branch, gutter pips for closed branches, Drop summary / Discard / Open as conversation, and that the main composer always posts to the spine.',
  ]
  const quote = typeof forwardedProps.quote === 'string' ? forwardedProps.quote : ''
  if (quote) {
    prompts.push(
      `The user is on a tangent branched from this quote:\n«${quote}»\nStay on this side-thread unless they ask to return to the spine.`,
    )
  }
  return prompts
}
