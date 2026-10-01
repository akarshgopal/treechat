/**
 * "Connect OpenRouter": OpenRouter's OAuth PKCE flow, so a person can log in
 * there and come back with a key instead of pasting one. No backend: the
 * verifier waits in sessionStorage while the page is away at openrouter.ai.
 * https://openrouter.ai/docs/use-cases/oauth-pkce
 */
const VERIFIER_KEY = 'treechat:openrouter-connect:v1'

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challengeFor(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

/** Leaves for openrouter.ai, which sends the person back here with `?code=`. */
export async function startOpenRouterConnect(): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  const url = new URL('https://openrouter.ai/auth')
  url.searchParams.set('callback_url', `${window.location.origin}${import.meta.env.BASE_URL}`)
  url.searchParams.set('code_challenge', await challengeFor(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('key_label', 'TreeChat')
  window.location.assign(url.toString())
}

/**
 * On load: the key from a connect that just came back, or null when this load
 * is not one. The code leaves the address bar either way. Throws with a
 * message to show when the exchange fails.
 */
export async function finishOpenRouterConnect(): Promise<string | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!code || !verifier) return null
  // Before the await: a second call (React StrictMode) must find nothing to do.
  sessionStorage.removeItem(VERIFIER_KEY)
  url.searchParams.delete('code')
  window.history.replaceState(window.history.state, '', url.toString())

  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  })
  if (!response.ok) {
    // Codes expire after 10 minutes and work once.
    throw new Error(response.status === 403 ? 'The sign-in expired or was already used. Try Connect again.' : `OpenRouter answered ${response.status}.`)
  }
  const { key } = (await response.json()) as { key?: unknown }
  if (typeof key !== 'string' || !key) throw new Error('OpenRouter sent no key.')
  return key
}
