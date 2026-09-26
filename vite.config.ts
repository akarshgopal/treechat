import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { resolveViteBase } from './vite-base.ts'

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
  // `.env` may set VITE_BASE; the real environment wins.
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }

  return {
    cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
    base: resolveViteBase(env),
    plugins: [react(), tailwindcss(), dropUnusedOnnxWasm()],
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
