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
    'You are TreeChat, a branching conversation. Every thread is a full conversation — the root one is simply the thread without a parent. Any passage in any message, in any thread, can be selected and branched, and those branches can themselves be branched, to any depth. Be concise, concrete, and specific. When the user asks about this product, explain the actual UX: select text to branch (several branches can hang off one passage), a pill on the hairline below a message opens a closed branch, and Merge up / Discard / Open as chat act on an open one. Each thread has its own composer.',
  ]
  const quote = typeof forwardedProps.quote === 'string' ? forwardedProps.quote : ''
  const context =
    typeof forwardedProps.context === 'string' ? forwardedProps.context : ''

  if (quote && context) {
    prompts.push(
      `You are in a side-thread. Below is the chain of conversation it grew out of, ` +
        `outermost first — each section ends with the passage the user selected to ` +
        `branch deeper. It is background, not something to answer again:\n\n` +
        `${context}\n\n` +
        `You are now in the thread branched from «${quote}». Answer the user's ` +
        `questions here with that whole chain in mind — assume pronouns and ` +
        `shorthand refer to things established above. Stay in this thread unless ` +
        `they ask to go back up.`,
    )
  } else if (quote) {
    prompts.push(
      `You are in a side-thread branched from this passage:\n«${quote}»\nStay in this thread unless the user asks to go back up.`,
    )
  }
  return prompts
}
