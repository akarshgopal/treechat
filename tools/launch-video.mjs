// Launch video, filmed from the real app.
//
// The app runs in an iframe at a laptop-sized viewport (1560x860) on a 1920x1080
// stage, so its layout is genuine; captions, the cursor, the camera and the title
// cards are stage graphics around it.
//
// Two passes, same script and same clicks:
//   node tools/launch-video.mjs record   real model answers (needs OPENROUTER_API_KEY in
//                                        the env or .env; costs a few cents), saved to
//                                        tools/launch-video.json
//   node tools/launch-video.mjs          film: replays those answers through the app's
//                                        normal streaming path at an even pace, so every
//                                        take is identical and costs nothing
//
// Needs `pnpm dev` running (TREECHAT_URL, default http://localhost:5174/) and ffmpeg.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODE = process.argv[2] === 'record' ? 'record' : 'film'
const URL = process.env.TREECHAT_URL ?? 'http://localhost:5174/'
const REC_FILE = 'tools/launch-video.json'
const OUT = process.env.TREECHAT_VIDEO_OUT ?? 'launch-video'
const MUSIC = process.env.TREECHAT_MUSIC ?? '../pdfdiff/tools/fassounds-upbeat-advertising-funk-412226.mp3'
// The track's drop (measured for the pdfdiff video); it should land as the app appears.
const DROP_AT = 7.1
const SIZE = { width: 1920, height: 1080 }
// The app renders at a laptop size and is shown 1.2x, so its text reads on video.
const APP = { w: 1280, h: 720, zoom: 1.2 }
const CARD = { x: 192, y: 44, w: APP.w * APP.zoom, h: APP.h * APP.zoom }
// Replay pace: brisk but readable, and the same on every take.
const CHARS_PER_SECOND = 700
// A long reply speeds up so that no reply streams for longer than this.
const MAX_STREAM_SECONDS = 1.8
const FIRST_TOKEN_MS = 450

const QUESTION = 'How does GPS know where I am?'
// Passages to branch from, picked from the real answers during `record`.
const EXPLAIN_PATTERNS = [/trilateration/i, /atomic clocks?/i, /time signals?/i]
const SOURCE_PATTERNS = [
  /\b\d[\d,.]*\s?(nanoseconds?|microseconds?|metres|meters?|kilometers?|km|miles)\b/i,
  /at least (three|four) satellites/i,
  /(three|four) satellites/i,
]

// ---------------------------------------------------------------- in-page hooks

/**
 * Runs in the stage and in the app frame. Each chat completion is answered
 * from the recording, keyed by its messages, as a paced stream; `record` sends
 * the ones it has no answer for to OpenRouter and tees them into window.top. A request with no recording fails loudly
 * instead of reaching the network.
 */
function pageHooks({ mode, responses, cps, maxSeconds, firstTokenMs, apiKey }) {
  try {
    localStorage.setItem('treechat:provider:v1', JSON.stringify({ provider: 'openrouter', apiKey, model: 'openai/gpt-5.6-luna' }))
    localStorage.setItem('treechat:web-search-cost-seen', '1')
  } catch {}
  const real = window.fetch.bind(window)
  const keyOf = async (body) => {
    const messages = JSON.stringify(JSON.parse(body).messages)
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messages))
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
  }
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('openrouter.ai/api/v1/chat/completions')) return real(input, init)
    const log = (window.top.__film ??= { responses: {}, misses: [], used: [] })
    const key = await keyOf(init.body)
    log.used.push(key)
    // Recording reuses what it already has, so changing one pick re-asks only what changed.
    if (mode === 'record' && !responses[key]) {
      const res = await real(input, init)
      if (!res.ok || !res.body) return res
      const [app, copy] = res.body.tee()
      new Response(copy).text().then((text) => { log.responses[key] = text })
      return new Response(app, { status: res.status, headers: res.headers })
    }
    const sse = responses[key]
    if (!sse) {
      log.misses.push(key)
      return new Response('{"error":{"message":"No recording for this request."}}', { status: 500 })
    }
    const events = sse.replace(/\r\n/g, '\n').split('\n\n')
    const charsOf = (event) => {
      let chars = 0
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          for (const choice of JSON.parse(line.slice(5)).choices ?? []) chars += choice.delta?.content?.length ?? 0
        } catch {}
      }
      return chars
    }
    const pace = Math.max(cps, events.reduce((n, e) => n + charsOf(e), 0) / maxSeconds)
    const encoder = new TextEncoder()
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const body = new ReadableStream({
      async start(controller) {
        await wait(firstTokenMs)
        // One chunk per video frame, like a network read: an event per chunk makes
        // the app re-render a long answer hundreds of times and fall behind.
        let owed = 0
        let pending = ''
        for (const event of events) {
          if (init.signal?.aborted) break
          if (!event.trim()) continue
          pending += `${event}\n\n`
          owed += (charsOf(event) * 1000) / pace
          if (owed >= 33) {
            controller.enqueue(encoder.encode(pending))
            pending = ''
            await wait(owed)
            owed = 0
          }
        }
        if (pending) controller.enqueue(encoder.encode(pending))
        controller.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

// ---------------------------------------------------------------- stage

const LOGO = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="8" fill="#1F3A2E"/>
  <path class="draw" d="M16 26V14" stroke="#E8F0E4" stroke-width="2" stroke-linecap="round"/>
  <path class="draw d2" d="M16 18.5c-3.2-1.2-5.2-3.4-6.4-6.2" stroke="#9FCB8A" stroke-width="2" stroke-linecap="round"/>
  <path class="draw d3" d="M16 16.5c2.8-1 4.8-2.8 6-5.4" stroke="#9FCB8A" stroke-width="2" stroke-linecap="round"/>
  <circle class="bud b1" cx="9.2" cy="11.4" r="2.1" fill="#C8E3B0"/>
  <circle class="bud b2" cx="22.4" cy="10.4" r="2.1" fill="#C8E3B0"/>
  <circle class="bud b3" cx="16" cy="8.2" r="2.6" fill="#E8F0E4"/>
</svg>`

const CHIPS = ['Branch any passage', 'Cited sources', 'Bring back takeaways', 'Map every tangent']

const STAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Franklin; font-weight: 400; src: url(/node_modules/@fontsource/libre-franklin/files/libre-franklin-latin-400-normal.woff2) format("woff2"); }
  @font-face { font-family: Franklin; font-weight: 500; src: url(/node_modules/@fontsource/libre-franklin/files/libre-franklin-latin-500-normal.woff2) format("woff2"); }
  @font-face { font-family: Franklin; font-weight: 600; src: url(/node_modules/@fontsource/libre-franklin/files/libre-franklin-latin-600-normal.woff2) format("woff2"); }
  @font-face { font-family: Franklin; font-weight: 700; src: url(/node_modules/@fontsource/libre-franklin/files/libre-franklin-latin-700-normal.woff2) format("woff2"); }
  :root { --bg: #0f1113; --fg: #e8eae7; --muted: #9aa09a; --branch: oklch(0.72 0.1 163); --bright: oklch(0.86 0.07 163); --ease: cubic-bezier(.2,.7,.25,1); }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); color: var(--fg);
    font-family: Franklin, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  #bg { position: fixed; inset: 0;
    background: radial-gradient(1100px 700px at 50% 38%, oklch(0.3 0.05 163 / .5), transparent 70%),
      radial-gradient(#1b1e21 1.4px, transparent 1.4px) 0 0 / 30px 30px; }
  #cam { position: fixed; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; }
  #card { position: absolute; left: ${CARD.x}px; top: ${CARD.y}px; width: ${CARD.w}px; height: ${CARD.h}px;
    border-radius: 16px; overflow: hidden; border: 1px solid #2c3034;
    box-shadow: 0 40px 120px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.02);
    opacity: 0; transform: translateY(46px) scale(.965); }
  #card.in { transition: opacity 700ms var(--ease), transform 900ms var(--ease); opacity: 1; transform: none; }
  #card.out { transition: opacity 600ms ease, transform 800ms var(--ease); opacity: 0; transform: scale(.92); }
  iframe { width: ${APP.w}px; height: ${APP.h}px; border: 0; display: block; background: #15171a;
    transform: scale(${APP.zoom}); transform-origin: 0 0; }
  #caption { position: fixed; left: 0; right: 0; top: ${CARD.y + CARD.h + 34}px; height: 90px;
    display: grid; place-items: center; pointer-events: none; }
  .cap { grid-area: 1 / 1; font-size: 44px; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap;
    padding: 14px 34px; border-radius: 999px; background: rgb(15 17 19 / .82); backdrop-filter: blur(14px);
    box-shadow: 0 10px 40px rgba(0,0,0,.45);
    opacity: 0; transform: translateY(26px); transition: opacity 420ms var(--ease), transform 520ms var(--ease); }
  .cap.on { opacity: 1; transform: none; }
  .cap.off { opacity: 0; transform: translateY(-22px); }
  .cap em { font-style: normal; color: var(--bright); }
  #cursor { position: fixed; left: 0; top: 0; width: 40px; height: 40px; z-index: 50; pointer-events: none;
    filter: drop-shadow(0 3px 6px rgba(0,0,0,.55)); opacity: 0; transition: opacity 300ms; }
  #cursor.on { opacity: 1; }
  .ripple { position: fixed; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%; z-index: 49;
    border: 2px solid var(--bright); pointer-events: none; animation: ripple 520ms var(--ease) forwards; }
  @keyframes ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.25); opacity: 0; } }
  .title { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 34px; pointer-events: none; }
  .lockup { display: flex; align-items: center; gap: 26px; }
  .lockup svg { width: 112px; height: 112px; display: block; }
  .word { font-size: 104px; font-weight: 700; letter-spacing: -0.035em; }
  .tag { font-size: 50px; font-weight: 500; letter-spacing: -0.02em; color: var(--muted); }
  .tag em { font-style: normal; color: var(--fg); }
  .draw { stroke-dasharray: 20; stroke-dashoffset: 20; }
  .bud { transform-box: fill-box; transform-origin: center; transform: scale(0); }
  .go .draw { animation: draw 520ms var(--ease) forwards; }
  .go .d2 { animation-delay: 260ms; } .go .d3 { animation-delay: 360ms; }
  .go .bud { animation: bud 420ms cubic-bezier(.3,1.6,.5,1) forwards; }
  .go .b1 { animation-delay: 620ms; } .go .b2 { animation-delay: 700ms; } .go .b3 { animation-delay: 440ms; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes bud { to { transform: scale(1); } }
  .rise { opacity: 0; transform: translateY(24px); }
  .go .rise { animation: rise 640ms var(--ease) forwards; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  #intro.leave { transition: opacity 450ms ease, transform 700ms var(--ease); opacity: 0; transform: scale(.9); }
  #end { opacity: 0; }
  #end.go { opacity: 1; }
  .chips { display: flex; gap: 16px; margin-top: 12px; }
  .chip { padding: 15px 26px; border-radius: 999px; border: 1px solid #2f3437; background: #181b1e;
    font-size: 26px; font-weight: 500; display: flex; align-items: center; gap: 12px; }
  .chip i { width: 9px; height: 9px; border-radius: 50%; background: var(--branch); display: block; }
  .url { font-size: 30px; color: var(--muted); letter-spacing: 0; margin-top: 8px; }
  .url b { color: var(--fg); font-weight: 500; }
</style></head><body>
  <div id="bg"></div>
  <div id="cam"><div id="card"><iframe name="app" src="/"></iframe></div></div>
  <div id="caption"></div>
  <div id="intro" class="title">
    <div class="lockup">${LOGO}<span class="word rise" style="animation-delay:300ms">TreeChat</span></div>
    <p class="tag rise" style="animation-delay:650ms">Follow every tangent. <em>Keep your place.</em></p>
  </div>
  <div id="end" class="title">
    <div class="lockup">${LOGO}<span class="word rise" style="animation-delay:250ms">TreeChat</span></div>
    <p class="tag rise" style="animation-delay:550ms">Follow every tangent. <em>Keep your place.</em></p>
    <div class="chips">${CHIPS.map((c, i) => `<span class="chip rise" style="animation-delay:${900 + i * 110}ms"><i></i>${c}</span>`).join('')}</div>
    <p class="url rise" style="animation-delay:1500ms">Free and open source · your key, your browser · <b>akarshgopal.github.io/treechat</b></p>
  </div>
  <svg id="cursor" viewBox="0 0 24 24"><path d="M4 2.5 19.5 13l-7 1.2 4 7.3-3 1.6-4-7.4L4 20.5Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>
</body></html>`

// ---------------------------------------------------------------- driver

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function makeDriver(page) {
  const cam = { s: 1, tx: 0, ty: 0 }
  const cur = { x: 1180, y: 760 }
  const frame = () => page.frame({ name: 'app' })
  const app = page.frameLocator('iframe[name="app"]')
  const toStage = (x, y) => ({ x: cam.tx + cam.s * (CARD.x + APP.zoom * x), y: cam.ty + cam.s * (CARD.y + APP.zoom * y) })

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  /** Push in on an app point (frame coords); the card keeps filling the frame. */
  async function camera(s, fx = 0, fy = 0, ms = 900) {
    Object.assign(cam, s === 1 ? { s: 1, tx: 0, ty: 0 } : {
      s,
      tx: clamp(960 - s * (CARD.x + APP.zoom * fx), SIZE.width - s * (CARD.x + CARD.w), -s * CARD.x),
      ty: clamp(476 - s * (CARD.y + APP.zoom * fy), SIZE.height - s * (CARD.y + CARD.h), -s * CARD.y),
    })
    await page.evaluate(({ s, tx, ty, ms }) => {
      const el = document.getElementById('cam')
      el.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
    }, { ...cam, ms })
    await wait(ms)
  }

  /** Cursor graphic and real mouse travel together, on the same easing. */
  async function move(to, ms = 650) {
    const from = { ...cur }
    await page.evaluate(({ x, y, ms }) => {
      const c = document.getElementById('cursor')
      c.classList.add('on')
      c.style.transition = `opacity 300ms, transform ${ms}ms cubic-bezier(.65,0,.35,1)`
      c.style.transform = `translate(${x - 4}px, ${y - 2}px)`
    }, { ...to, ms })
    const start = Date.now()
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / ms)
      const k = ease(t)
      await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
      if (t >= 1) break
      await wait(12)
    }
    Object.assign(cur, to)
  }

  async function click(to, ms) {
    if (to) await move(to, ms)
    await page.evaluate(({ x, y }) => {
      const r = document.createElement('div')
      r.className = 'ripple'
      r.style.left = `${x}px`
      r.style.top = `${y}px`
      document.body.append(r)
      setTimeout(() => r.remove(), 600)
    }, cur)
    await page.mouse.down()
    await wait(70)
    await page.mouse.up()
  }

  /** Push in on everything `locator` matches. */
  async function focus(locator, s, ms) {
    const r = await locator.evaluateAll((els) => {
      const bs = els.map((el) => el.getBoundingClientRect())
      const top = Math.min(...bs.map((b) => b.top))
      const bottom = Math.min(Math.max(...bs.map((b) => b.bottom)), top + 720)
      const left = Math.min(...bs.map((b) => b.left))
      const right = Math.max(...bs.map((b) => b.right))
      return { x: (left + right) / 2, y: (top + bottom) / 2 }
    })
    await camera(s, r.x, r.y, ms)
  }

  async function centerOf(locator) {
    await locator.first().waitFor({ state: 'visible', timeout: 60_000 })
    const r = await locator.first().evaluate((el) => {
      const b = el.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    })
    return toStage(r.x, r.y)
  }

  /** Drag-select `phrase` inside `locator`, as a person would. */
  async function select(locator, phrase) {
    await locator.first().scrollIntoViewIfNeeded()
    const ends = await locator.first().evaluate((root, phrase) => {
      const nodes = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement?.closest('[data-offset-ignore]') ? 2 : 1),
      })
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n)
      const text = nodes.map((n) => n.data).join('')
      const at = text.indexOf(phrase)
      if (at < 0) throw new Error(`"${phrase}" not found`)
      const locate = (offset) => {
        for (const n of nodes) {
          if (offset <= n.data.length) return [n, offset]
          offset -= n.data.length
        }
      }
      const range = document.createRange()
      range.setStart(...locate(at))
      range.setEnd(...locate(at + phrase.length))
      const rects = [...range.getClientRects()].filter((r) => r.width > 0)
      const a = rects[0]
      const b = rects[rects.length - 1]
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 }
    }, phrase)
    await move(toStage(ends.x1, ends.y1), 750)
    await page.mouse.down()
    await move(toStage(ends.x2, ends.y2), 700)
    await page.mouse.up()
  }

  async function caption(html) {
    if (process.env.DEBUG) console.log(`${new Date().toISOString().slice(17, 23)} caption ${html}`)
    await page.evaluate((html) => {
      const box = document.getElementById('caption')
      for (const old of box.children) {
        old.classList.replace('on', 'off')
        setTimeout(() => old.remove(), 600)
      }
      if (!html) return
      const el = document.createElement('div')
      el.className = 'cap'
      el.innerHTML = html
      box.append(el)
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')))
    }, html)
  }

  /** A reply ran: its stop button came and went. */
  async function replied() {
    const t = Date.now()
    const stop = app.locator('[data-testid="composer-stop"]')
    await stop.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    await stop.first().waitFor({ state: 'detached', timeout: 180_000 })
    if (process.env.DEBUG) console.log(`  reply ${Date.now() - t}ms`)
    const misses = await page.evaluate(() => window.__film?.misses ?? [])
    if (misses.length) throw new Error(`no recording for ${misses.length} request(s); run \`record\` again`)
  }

  const lastText = (locator) => locator.last().evaluate((el) => el.innerText)
  const cls = (id, name, on = true) => page.evaluate(({ id, name, on }) => document.getElementById(id).classList.toggle(name, on), { id, name, on })

  return { page, app, frame, camera, focus, move, click, centerOf, select, caption, replied, lastText, cls }
}

function pick(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  // No match: three words from the middle of the text.
  const words = text.split(/\s+/)
  const i = Math.floor(words.length / 2)
  return words.slice(i, i + 3).join(' ').replace(/[.,;:]$/, '')
}

/** The film. `mark()` notes where the video starts. */
async function scene(d, picks, mark) {
  const { app, page } = d
  const lanes = app.locator('[data-lane-section]')
  const messages = (lane) => lane.locator('[data-message-id]')

  // Intro: the logo grows, then trades places with the app.
  mark()
  await d.cls('intro', 'go')
  await wait(2000)
  await d.cls('intro', 'leave')
  await d.cls('card', 'in')
  await wait(750)

  await d.caption('Ask <em>anything.</em>')
  await d.click(await d.centerOf(app.locator('textarea')), 800)
  await page.keyboard.type(QUESTION, { delay: 38 })
  await wait(250)
  await page.keyboard.press('Enter')
  await d.replied()
  const main = lanes.first()
  picks.explain ??= pick(await d.lastText(messages(main)), EXPLAIN_PATTERNS)
  await wait(450)

  // Branch: select a passage, one tap on Explain.
  await d.caption('Select any passage. <em>Branch it.</em>')
  const reply = messages(main).filter({ hasText: picks.explain }).last()
  const at = await reply.evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  await d.camera(1.32, at.x, at.y, 700)
  await d.select(reply, picks.explain)
  await wait(450)
  await d.click(await d.centerOf(app.locator('[data-lens="explain"]')), 600)
  await wait(100)
  await d.camera(1, 0, 0, 700)
  await d.replied()
  const branch = lanes.nth(1)
  picks.source ??= pick(await d.lastText(messages(branch)), SOURCE_PATTERNS)
  await wait(600)

  // A branch of the branch, with web sources.
  await d.caption('Go deeper. <em>Check the sources.</em>')
  await d.select(messages(branch).filter({ hasText: picks.source }).last(), picks.source)
  await wait(400)
  await d.click(await d.centerOf(app.locator('[data-lens="source"]')), 600)
  await wait(250)
  await d.focus(lanes.last(), 1.28, 750)
  await d.replied()
  await wait(300)
  const chip = app.locator('[data-testid="citation-chip"]')
  if (await chip.count()) await d.move(await d.centerOf(chip), 700)
  await wait(900)
  await d.camera(1, 0, 0, 600)

  // Bring the finding back to the main conversation.
  await d.caption('Bring back <em>what you learned.</em>')
  await d.click(await d.centerOf(lanes.last().locator('[data-testid="back-to-spine"]')), 650)
  await wait(400)
  await d.click(await d.centerOf(lanes.last().locator('[data-testid="drop-summary"]')), 700)
  const confirm = app.locator('[data-testid="confirm-takeaway"]')
  await confirm.waitFor({ state: 'visible' })
  await app.locator('[data-testid="confirm-takeaway"]:not([disabled])').waitFor({ timeout: 120_000 })
  await wait(700)
  await d.click(await d.centerOf(confirm), 550)
  await wait(400)
  await d.focus(messages(main).last(), 1.3, 700)
  await wait(1300)
  await d.camera(1, 0, 0, 600)

  // The whole exploration at a glance.
  await d.caption('See the <em>whole tree.</em>')
  await d.click(await d.centerOf(app.locator('[data-testid="open-map"]')), 800)
  await wait(300)
  await d.focus(app.locator('[data-testid="map-card"]'), 1.45, 800)
  await wait(1600)

  // End card.
  await d.caption('')
  await page.evaluate(() => document.getElementById('cursor').classList.remove('on'))
  await d.cls('card', 'out')
  await wait(350)
  await d.cls('end', 'go')
  await wait(3800)
}

// ---------------------------------------------------------------- main

function apiKey() {
  if (MODE === 'film') return 'sk-or-v1-film-replay-only'
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
  const key = env.match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim()
  if (!key) throw new Error('record needs OPENROUTER_API_KEY')
  return key
}

// Edit a pick in the JSON and run `record` again to branch from a different passage.
const saved = existsSync(REC_FILE) ? JSON.parse(readFileSync(REC_FILE, 'utf8')) : { picks: {}, responses: {} }
const work = mkdtempSync(join(tmpdir(), 'treechat-video-'))
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  ...(MODE === 'film' ? { recordVideo: { dir: work, size: SIZE } } : {}),
})
await context.addInitScript(pageHooks, {
  mode: MODE,
  responses: saved.responses,
  cps: CHARS_PER_SECOND,
  maxSeconds: MAX_STREAM_SECONDS,
  firstTokenMs: FIRST_TOKEN_MS,
  apiKey: apiKey(),
})
const page = await context.newPage()
const t0 = Date.now()
page.setDefaultTimeout(60_000)
await page.goto(URL, { waitUntil: 'networkidle' })
await page.setContent(STAGE_HTML, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready.then(() => true))
const d = makeDriver(page)
await d.app.locator('textarea').waitFor({ state: 'visible' })
await wait(800)

const marks = { start: 0 }
const picks = { ...saved.picks }
try {
  await scene(d, picks, () => { marks.start = (Date.now() - t0) / 1000 })
} catch (error) {
  await page.screenshot({ path: `${OUT}-error.png` })
  throw error
}
marks.end = (Date.now() - t0) / 1000
console.log('picks:', picks)

if (MODE === 'record') {
  const film = await page.evaluate(() => window.__film)
  const all = { ...saved.responses, ...film.responses }
  const responses = Object.fromEntries(film.used.filter((key) => all[key]).map((key) => [key, all[key]]))
  writeFileSync(REC_FILE, `${JSON.stringify({ question: QUESTION, picks, responses }, null, 2)}\n`)
  console.log(`recorded ${Object.keys(responses).length} replies -> ${REC_FILE}`)
  await browser.close()
  rmSync(work, { recursive: true, force: true })
  process.exit(0)
}

await context.close()
await browser.close()
const raw = join(work, readdirSync(work).find((f) => f.endsWith('.webm')))
const length = Number((marks.end - marks.start).toFixed(3))
const silent = join(work, 'silent.mp4')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-ss', String(marks.start), '-t', String(length),
  '-vf', `fps=60,scale=${SIZE.width}:${SIZE.height}:flags=lanczos,setsar=1`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', silent])

if (existsSync(MUSIC)) {
  // The drop lands as the app card settles, about 3.2s in.
  const musicStart = Math.max(0, DROP_AT - 3.2)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-ss', String(musicStart), '-t', String(length), '-i', MUSIC,
    '-filter_complex', `[1:a]volume=-1dB,afade=t=in:st=0:d=0.3,afade=t=out:st=${(length - 1.5).toFixed(2)}:d=1.5[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', `${OUT}.mp4`])
} else {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-c', 'copy', `${OUT}.mp4`])
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-vf',
  'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  `${OUT}.gif`])
rmSync(work, { recursive: true, force: true })
console.log(`wrote ${OUT}.mp4 and ${OUT}.gif (${length}s)`)
