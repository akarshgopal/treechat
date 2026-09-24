import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { resolveViteBase } from './vite-base.ts'
import { treeChatApi } from './vite-plugin-api.ts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * transformers.js always points the ONNX runtime at jsDelivr, so the ~27 MB
 * WASM that onnxruntime-web's bundle references is never fetched. Leave it
 * out of the deploy.
 */
function dropUnusedOnnxWasm(): Plugin {
  return {
    name: 'treechat:drop-unused-onnx-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name]
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
    base: resolveViteBase(process.env),
    plugins: [react(), tailwindcss(), treeChatApi(), dropUnusedOnnxWasm()],
    worker: { plugins: () => [dropUnusedOnnxWasm()] },
    resolve: {
      alias: {
        '@': path.resolve(rootDir, './src'),
      },
    },
    server: {
      port: 5173,
    },
  }
})
