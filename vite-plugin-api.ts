import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleApiRequest } from './server/chat.ts'

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function incomingToRequest(
  req: IncomingMessage,
  signal: AbortSignal,
): Promise<Request> {
  const host = req.headers.host ?? 'localhost'
  const url = `http://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? await readBody(req) : undefined
  return new Request(url, {
    method,
    headers,
    body: body && body.length > 0 ? new Uint8Array(body) : undefined,
    signal,
  })
}

async function sendWebResponse(webRes: Response, res: ServerResponse) {
  res.statusCode = webRes.status
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.setHeader('X-Accel-Buffering', 'no')
  if (!webRes.body) {
    res.end()
    return
  }
  const reader = webRes.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch {
    if (!res.writableEnded) res.end()
  }
}

function isApiPath(url: string | undefined) {
  const path = url?.split('?')[0]
  return path === '/api/chat' || path === '/api/status'
}

export function treeChatApi(): Plugin {
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (!isApiPath(req.url)) {
      next()
      return
    }
    try {
      const abort = new AbortController()
      req.on('close', () => abort.abort())
      const request = await incomingToRequest(req, abort.signal)
      const webRes = await handleApiRequest(request)
      await sendWebResponse(webRes, res)
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end()
        return
      }
      const message = error instanceof Error ? error.message : 'API error'
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(message)
    }
  }

  return {
    name: 'treechat-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void middleware(req, res, next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void middleware(req, res, next)
      })
    },
  }
}
