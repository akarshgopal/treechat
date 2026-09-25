import { createOpenaiChatCompletions } from '@tanstack/ai-openai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'

export type ProviderId = 'xai' | 'openai' | 'openrouter' | 'mock'

export type ProviderStatus = {
  mode: 'mock' | 'live'
  provider: ProviderId
  model: string
}

/** String env map from the Vite plugin, tests, or a process env fallback. */
export type RequestEnv = Record<string, string | undefined>

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.6-luna'
export const TREECHAT_MODEL_HEADER = 'X-TreeChat-Model'

type ResolvedProvider = ProviderStatus & { apiKey: string | null }

function processEnv(name: string): string | undefined {
  try {
    const value = globalThis.process?.env?.[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  } catch {
    // Some runtimes have no process.env.
  }
  return undefined
}

function envValue(name: string, env?: RequestEnv): string | undefined {
  const direct = env?.[name]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  return processEnv(name)
}

export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('Authorization')
  if (!header) return undefined
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token || undefined
}

export function modelFromRequest(request: Request): string | undefined {
  const model = request.headers.get(TREECHAT_MODEL_HEADER)?.trim()
  return model || undefined
}

/**
 * Per-request BYOK (OpenRouter) wins. Env keys are local-dev fallbacks.
 */
export function resolveProvider(
  request?: Request | null,
  env?: RequestEnv,
): ResolvedProvider {
  const headerKey = request ? bearerToken(request) : undefined
  const headerModel = request ? modelFromRequest(request) : undefined

  if (headerKey) {
    return {
      mode: 'live',
      provider: 'openrouter',
      model: headerModel || envValue('OPENROUTER_MODEL', env) || DEFAULT_OPENROUTER_MODEL,
      apiKey: headerKey,
    }
  }

  const xaiKey = envValue('XAI_API_KEY', env)
  if (xaiKey) {
    return {
      mode: 'live',
      provider: 'xai',
      model: headerModel || envValue('XAI_MODEL', env) || 'grok-4.6',
      apiKey: xaiKey,
    }
  }

  const openaiKey = envValue('OPENAI_API_KEY', env)
  if (openaiKey) {
    return {
      mode: 'live',
      provider: 'openai',
      model: headerModel || envValue('OPENAI_MODEL', env) || 'gpt-4.1-mini',
      apiKey: openaiKey,
    }
  }

  const openrouterKey = envValue('OPENROUTER_API_KEY', env)
  if (openrouterKey) {
    return {
      mode: 'live',
      provider: 'openrouter',
      model: headerModel || envValue('OPENROUTER_MODEL', env) || DEFAULT_OPENROUTER_MODEL,
      apiKey: openrouterKey,
    }
  }

  return { mode: 'mock', provider: 'mock', model: 'treechat-mock', apiKey: null }
}

export function getProviderStatus(
  request?: Request | null,
  env?: RequestEnv,
): ProviderStatus {
  const resolved = resolveProvider(request, env)
  return {
    mode: resolved.mode,
    provider: resolved.provider,
    model: resolved.model,
  }
}

export function getTextAdapter(request?: Request | null, env?: RequestEnv) {
  const status = resolveProvider(request, env)
  if (!status.apiKey || status.provider === 'mock') return null

  if (status.provider === 'xai') {
    return openaiCompatibleText(status.model, {
      name: 'xai',
      apiKey: status.apiKey,
      baseURL: 'https://api.x.ai/v1',
      api: 'chat-completions',
    })
  }
  if (status.provider === 'openai') {
    return createOpenaiChatCompletions(
      status.model as 'gpt-4.1-mini',
      status.apiKey,
    )
  }
  return openaiCompatibleText(status.model, {
    name: 'openrouter',
    apiKey: status.apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    api: 'chat-completions',
  })
}
