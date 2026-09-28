import { expect, type Page } from './fixtures'
import { afterSaves } from './library'

/** Replace the open chat with the seeded demo, and wait until it is saved. */
export async function restoreDemo(page: Page) {
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-restore-demo').click()
  await expect(page.locator('[data-message-id="msg-root-4"]')).toBeAttached()
  await afterSaves(page)
}

/**
 * Select `text` inside the element matching `selector` by visible-text
 * position, across element boundaries, and wait for the lens bar.
 */
export async function selectText(page: Page, selector: string, text: string) {
  const element = page.locator(selector).first()
  await element.scrollIntoViewIfNeeded()
  await expect(async () => {
    await element.evaluate((root, text) => {
      const nodes: Text[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement?.closest('[data-offset-ignore]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      })
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
      const plain = nodes.map((node) => node.data).join('')
      const start = plain.indexOf(text)
      if (start < 0) throw new Error(`"${text}" not found`)
      const locate = (offset: number) => {
        for (const node of nodes) {
          if (offset <= node.data.length) return { node, offset }
          offset -= node.data.length
        }
        throw new Error('offset out of range')
      }
      const from = locate(start)
      const to = locate(start + text.length)
      const range = document.createRange()
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    }, text)
    await expect(page.getByTestId('branch-popover')).toHaveAttribute('data-mode', 'lenses', { timeout: 1500 })
  }).toPass({ timeout: 10_000 })
}
