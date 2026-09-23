/**
 * BM25 over chunk text. The fallback when the embedding model cannot load
 * (offline on first use, no WASM), so documents still answer questions.
 */

const STOP_WORDS = new Set(
  'a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your'.split(' '),
)

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0]
    if (token.length < 2 || STOP_WORDS.has(token)) continue
    tokens.push(stem(token))
  }
  return tokens
}

/** Just enough stemming that "documents" finds "document". */
function stem(token: string) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 3 && token.endsWith('es') && /(ss|x|ch|sh)es$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

const K1 = 1.2
const B = 0.75

/** Score each text against the query; 0 means no query term appears. */
export function bm25Scores(query: string, texts: string[]): number[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0 || texts.length === 0) return texts.map(() => 0)
  const docs = texts.map((text) => {
    const counts = new Map<string, number>()
    const tokens = tokenize(text)
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return { counts, length: tokens.length }
  })
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1
  const idf = new Map(terms.map((term) => {
    const containing = docs.filter((doc) => doc.counts.has(term)).length
    return [term, Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5))]
  }))
  return docs.map((doc) => {
    let score = 0
    for (const term of terms) {
      const frequency = doc.counts.get(term) ?? 0
      if (!frequency) continue
      score += idf.get(term)! * (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * doc.length / average))
    }
    return score
  })
}
