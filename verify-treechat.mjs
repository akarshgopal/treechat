import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
page.setDefaultTimeout(12000)
const errors = []
page.on('pageerror', (err) => errors.push(String(err)))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})

await page.setViewport({ width: 1280, height: 900 })
await page.evaluateOnNewDocument(() => localStorage.clear())
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('header', { timeout: 10000 })
await page.screenshot({ path: '/tmp/tc-1.png' })

const results = {}
const bodyText = () => page.evaluate(() => document.body.innerText)

results.hasTitle = (await bodyText()).includes('TreeChat')
results.hasSeed = (await bodyText()).includes('What is TreeChat?')
results.hasMock = (await bodyText()).includes('Mock stream')
results.hasQuote = (await bodyText()).includes(
  'select any passage and grow a side-thread from it',
)

const pip = await page.$('button[aria-label*="Open branch"]')
results.hasPip = Boolean(pip)
if (!pip) {
  console.log(JSON.stringify({ results, errors, text: await bodyText() }, null, 2))
  await browser.close()
  process.exit(1)
}
await pip.click()
await page.waitForFunction(() => document.body.innerText.includes('Posting to main'))
results.banner = true
results.inline = (await bodyText()).includes('The branch is pinned')
await page.screenshot({ path: '/tmp/tc-2.png' })

await page.click('[data-testid="open-as-conversation"]')
await page.waitForSelector('[data-testid="back-to-spine"]')
results.conversation = (await bodyText()).includes('Tangent conversation')
await page.screenshot({ path: '/tmp/tc-3.png' })

await page.$eval('[data-testid="back-to-spine"]', (el) => el.click())
await page.waitForFunction(
  () => document.querySelector('[data-view]')?.getAttribute('data-view') === 'spine',
)
results.backButton = !(await bodyText()).includes('Tangent conversation')

await page.click('[data-testid="open-as-conversation"]')
await page.waitForSelector('[data-testid="back-to-spine"]')
await page.click('body')
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 400))
results.escBack =
  (await page.$eval('[data-view]', (el) => el.getAttribute('data-view'))) === 'spine'
if (!results.escBack) {
  await page.$eval('[data-testid="back-to-spine"]', (el) => el.click())
  await page.waitForFunction(
    () => document.querySelector('[data-view]')?.getAttribute('data-view') === 'spine',
  )
}

if (!(await page.$('textarea[placeholder*="branch"]'))) {
  const pip2 = await page.$('button[aria-label*="Open branch"]')
  if (pip2) await pip2.click()
}
await page.waitForSelector('textarea[placeholder*="branch"]')

await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea')].find((t) =>
    t.placeholder.includes('branch'),
  )
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  ).set
  ta.focus()
  setter.call(ta, 'Does the composer stay on the branch?')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 100))
await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea')].find((t) =>
    t.placeholder.includes('branch'),
  )
  ta.closest('form').querySelector('button[type="submit"]').click()
})
await page.waitForFunction(
  () =>
    document.body.innerText.includes('On this tangent') ||
    document.body.innerText.includes('Staying on the branch'),
  { timeout: 10000 },
)
results.branchStream = true

await page.click('[data-testid="drop-summary"]')
await page.waitForFunction(
  () => /dropped from/i.test(document.body.innerText),
  { timeout: 12000 },
)
results.dropSummary = true
await page.screenshot({ path: '/tmp/tc-4.png' })

const msg = await page.$('[data-message-id="msg-spine-4"]')
const box = await msg.boundingBox()
await page.mouse.move(box.x + 24, box.y + 10)
await page.mouse.down()
await page.mouse.move(box.x + 200, box.y + 10, { steps: 10 })
await page.mouse.up()
await new Promise((r) => setTimeout(r, 300))
results.chip = Boolean(await page.$('[data-testid="branch-chip"]'))
if (results.chip) {
  await page.click('[data-testid="branch-chip"]')
  await page.waitForFunction(() =>
    document.body.innerText.includes('This tangent is empty'),
  )
  results.newBranch = true
}

await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea')].find((t) =>
    t.placeholder.includes('spine'),
  )
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  ).set
  ta.focus()
  setter.call(ta, 'How do closed branches look?')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 100))
await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea')].find((t) =>
    t.placeholder.includes('spine'),
  )
  ta.closest('form').querySelector('button[type="submit"]').click()
})
await page.waitForFunction(
  () =>
    document.body.innerText.includes('Closed branches stay quiet') ||
    document.body.innerText.includes('quiet underline'),
  { timeout: 10000 },
)
results.spineStream = true
await page.screenshot({ path: '/tmp/tc-5.png' })

console.log(JSON.stringify({ results, errors }, null, 2))
fs.writeFileSync('/tmp/tc-text.txt', await bodyText())
await browser.close()
const failed = Object.entries(results).filter(([, v]) => v !== true)
if (failed.length || errors.length) {
  console.error('FAILED', failed)
  process.exit(1)
}
