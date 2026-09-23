import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ExtractedDocument, TextBlock } from './types.ts'

// Only ever imported dynamically, so pdf.js stays out of the main bundle.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** One block per page, so every chunk can say which page it came from. */
export async function extractPdf(data: Uint8Array): Promise<ExtractedDocument> {
  const task = pdfjs.getDocument({ data })
  const pdf = await task.promise
  const blocks: TextBlock[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        text += item.hasEOL ? '\n' : ''
      }
      // pdf.js reports line ends, not paragraphs; a blank-ish line gap is the
      // closest signal we have, so collapse runs of spaces but keep newlines.
      const cleaned = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      if (cleaned) blocks.push({ text: cleaned, page: pageNumber })
      page.cleanup()
    }
    return { format: 'pdf', blocks, pages: pdf.numPages }
  } finally {
    void task.destroy()
  }
}
