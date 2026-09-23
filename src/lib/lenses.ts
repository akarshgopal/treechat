import { clipText } from './tree.ts'

/**
 * One-tap questions offered on a selection. Each becomes the branch's first
 * message, so it also names the branch in the tree — hence the clipped quote.
 */
export type Lens = {
  id: string
  label: string
  ask: (quote: string) => string
}

export const LENSES: readonly Lens[] = [
  { id: 'explain', label: 'Explain', ask: (q) => `Explain “${q}”` },
  { id: 'example', label: 'Example', ask: (q) => `Give a concrete example of “${q}”` },
  { id: 'source', label: 'Source?', ask: (q) => `What's the evidence or source for “${q}”?` },
  { id: 'challenge', label: 'Challenge', ask: (q) => `What's the strongest case against “${q}”?` },
  { id: 'simpler', label: 'Simpler', ask: (q) => `Say “${q}” more simply` },
  { id: 'deeper', label: 'Deeper', ask: (q) => `Go deeper on “${q}”` },
]

export const LENS_QUOTE_CHARS = 60

export function lensQuestion(lens: Lens, quote: string): string {
  return lens.ask(clipText(quote, LENS_QUOTE_CHARS))
}
