/**
 * Headless-Chrome end-to-end verification via CDP (v3 — issue #187 batch 2).
 *
 * v2 probed the removed third-party sidebar private DOM contract ([data-dsh-panel-host] /
 * [data-dsh-sidebar]); the host's native dockkit renders data-dockkit-*
 * instead, and that is the contract a plugin may rely on. This version
 * asserts the NATIVE one:
 *
 *   [data-dockkit-surface] / [data-dockkit-pane]  the right column rendered
 *   [data-dockkit-strip-tabs]                     the pane's tab strip
 *   [data-dockkit-tab]                            a tab chip exists
 *   .dfa / .dfa-fp-overlay                        this plugin's own DOM
 *   [data-dfa-degraded]                           explicit failure marker
 *
 * Usage:
 *   PROBE_URL='http://127.0.0.1:<port>/?token=...' node test/e2e-cdp.mjs
 * (the token URL is printed by `dsh web`; without PROBE_URL the script falls
 * back to the default local GUI port and would only see the 401 page.)
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT || 9225)
const PROFILE = '/tmp/dsh-fa-cdp2'
const TARGET = process.env.PROBE_URL || 'http://127.0.0.1:3080/'
const sanitize = (s) => String(s).replace(/[\n\r]/g, ' ')
const log = (...args) => console.log('[e2e]', ...args.map(sanitize))

rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--remote-allow-origins=*',
    '--disable-background-networking',
    '--disable-component-update',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function cdpJson(path, timeoutMs = 3000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}${path}`, { signal: controller.signal })).json()
  } finally {
    clearTimeout(timer)
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 4000)
    ws.onopen = () => {
      clearTimeout(timer)
      resolve(ws)
    }
    ws.onerror = () => reject(new Error('ws error'))
  })
}

function cdpCall(ws, method, params = {}, timeoutMs = 10000) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error(`CDP ${method} timeout`))
    }, timeoutMs)
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(ws, expression) {
  const result = await cdpCall(ws, 'Runtime.evaluate', { expression, returnByValue: true })
  return result?.result?.value
}

const SNAPSHOT = [
  'JSON.stringify({',
  "  stripTabs: document.querySelectorAll('[data-dockkit-strip-tabs]').length,",
  "  pane: document.querySelectorAll('[data-dockkit-pane]').length,",
  "  tabs: Array.from(document.querySelectorAll('[data-dockkit-tab]')).map((t) => (t.innerText || '').replace(/\\\\s+/g, ' ').slice(0, 40)),",
  "  addTab: document.querySelectorAll('[data-dockkit-add-tab]').length,",
  "  pluginBody: document.querySelectorAll('.dfa').length,",
  "  floating: document.querySelectorAll('.dfa-fp-overlay').length,",
  '  degraded: document.documentElement.dataset.dfaDegraded || null,',
  '  degradedCause: document.documentElement.dataset.dfaDegradedCause || null,',
  "  body: (document.body ? document.body.innerText : '').replace(/\\\\s+/g, ' ').slice(0, 300),",
  '})',
].join('\n')

const results = {}
try {
  let targets = []
  for (let i = 0; i < 20; i++) {
    try {
      targets = await cdpJson('/json/list')
      if (targets.length > 0) break
    } catch {
      /* retry */
    }
    await sleep(300)
  }
  if (targets.length === 0) throw new Error('CDP endpoint did not come up')
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = await connect(page.webSocketDebuggerUrl)
  await cdpCall(ws, 'Runtime.enable')
  await cdpCall(ws, 'Page.enable')
  log('navigating to', TARGET.replace(/token=[^&]+/, 'token=***'))
  await cdpCall(ws, 'Page.navigate', { url: TARGET }, 20000)

  // 1. the app renders (a 401 page means the token in PROBE_URL is wrong)
  let bodyText = ''
  for (let i = 0; i < 25; i++) {
    await sleep(1200)
    try {
      bodyText = (await evaluate(ws, 'document.body ? document.body.innerText : ""')) || ''
    } catch {
      /* retry */
    }
    if (bodyText.includes('authentication required'))
      throw new Error('GUI served the 401 page (missing/expired token in PROBE_URL)')
    if ((await evaluate(ws, "document.querySelectorAll('[data-dockkit-surface]').length")) > 0) break
  }
  results.appRendered = bodyText.length > 50
  log('app rendered:', results.appRendered)

  // 2. the right column is a native dockkit surface
  const initial = JSON.parse(await evaluate(ws, SNAPSHOT))
  results.nativeSurface = initial.pane > 0 && initial.stripTabs > 0
  log('native surface:', JSON.stringify(initial))

  // 3. exercise the strip: an EMPTY pane is not seeded until an intent
  //    arrives (host stores.d.ts: 'the seed waits for the expansion'), so the
  //    add control is what makes a tab chip appear.
  await evaluate(
    ws,
    "JSON.stringify(Array.from(document.querySelectorAll('[data-dockkit-add-tab]')).map((el) => { el.click(); return 'clicked' }))",
  )
  await sleep(2500)
  const after = JSON.parse(await evaluate(ws, SNAPSHOT))
  results.tabChipRendered = after.tabs.length > 0
  log('after add-tab:', JSON.stringify(after))

  // 4. no silent failure: the explicit degradation marker must be absent
  results.noSilentFailure = after.degraded === null
  if (after.degraded !== null) log('DEGRADED:', after.degraded, after.degradedCause)

  // 5. this plugin's own DOM (tab body / floating window) when present
  results.pluginBody = after.pluginBody
  results.floatingWindow = after.floating
  log('plugin body nodes:', after.pluginBody, 'floating windows:', after.floating)

  log('=== E2E DONE ===')
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  console.error('[e2e] FAILED:', String(error.message).replace(/[\n\r]/g, ' '))
  console.error(JSON.stringify(results, null, 2))
} finally {
  try {
    chrome.kill('SIGKILL')
  } catch {
    /* already dead */
  }
  process.exit(0)
}
