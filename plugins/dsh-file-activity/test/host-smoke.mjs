import { test } from 'vitest'
/**
 * Smoke test for the dsh-file-activity host half: mounts the plugin against a
 * mocked context and drives fs/observed events + HTTP routes through it.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

// ── helpers ────────────────────────────────────────────────────────────────
function makeResponse() {
  return {
    _status: 0,
    _body: '',
    _headers: {},
    writeHead(status, headers) {
      this._status = status
      this._headers = headers ?? {}
    },
    end(body) {
      this._body = body ?? ''
    },
  }
}

function makeRequest(method, url, body) {
  const req = {
    method,
    url,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    },
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [JSON.stringify(body)]
      let i = 0
      return {
        next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { done: true }),
      }
    },
  }
  return req
}

/** Collect the handler the plugin registers for a route prefix. */
function captureRoute(prefix) {
  let captured
  const holder = {
    set: (route) => {
      if (route.kind === 'prefix' && route.path === prefix) captured = route
    },
    get: () => captured,
  }
  return holder
}

// ── test ─────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'dsh-file-activity-test-'))
process.env.DSH_HOME = dir
const statePath = join(dir, 'file-activity.json')

/** Build a plugin context, run apply, wait for state load, return handles. */
async function boot() {
  const apiHolder = captureRoute('/file-activity/api')
  const mediaHolder = captureRoute('/file-activity/file')
  const ctx = {
    logger: { warn: () => {} },
    webRuntime: { trustedHosts: [] },
    sessions: { get: () => undefined },
    webServer: {
      register: (route) => {
        apiHolder.set(route)
        mediaHolder.set(route)
        return () => {}
      },
    },
    events: [],
    effectCallbacks: [],
    on(name, listener) {
      this.events.push({ name, listener })
    },
    effect(callback, label) {
      this.effectCallbacks.push({ callback, label })
      const disposer = callback()
      if (typeof disposer === 'function') this.effectCallbacks.push({ disposer, label: `${label}:disposer` })
      return disposer
    },
  }
  apply(ctx)
  // wait for async state load
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { ctx, getRoute: () => apiHolder.get(), getMediaRoute: () => mediaHolder.get() }
}

function emitObserved(ctx, toolName, sessionId, path, opts) {
  const { listener } = ctx.events.find((e) => e.name === 'fs/observed')
  const { observation, args } = opts ?? {}
  listener({ displayPath: path }, observation ?? { kind: 'present' }, {
    name: toolName,
    agent: { id: sessionId },
    arguments: args ?? { file_path: path },
  })
}

async function callRoute(getRoute, method, url, body) {
  const route = getRoute()
  assert.ok(route, 'route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, url, body), res)
  return { status: res._status, json: JSON.parse(res._body) }
}

/** Call the binary media route (the response body is raw bytes, not JSON). */
async function callMedia(getMediaRoute, method, url) {
  const route = getMediaRoute()
  assert.ok(route, 'media route registered')
  const res = makeResponse()
  await route.handler(makeRequest(method, url), res)
  return { status: res._status, headers: res._headers, body: res._body }
}

test('host smoke suite', async () => {
  try {
    const { ctx, getRoute } = await boot()
    const sid = 'session-1'

    // 1. agent read → read count + recent
    emitObserved(ctx, 'read', sid, '/work/a.txt')
    emitObserved(ctx, 'read', sid, '/work/a.txt')

    // 2. first write → create
    emitObserved(ctx, 'write', sid, '/work/b.txt')

    // 3. second write → modify
    emitObserved(ctx, 'write', sid, '/work/b.txt')

    // 4. edit → modify
    emitObserved(ctx, 'edit', sid, '/work/a.txt')

    // 5. absent observation → ignored
    emitObserved(ctx, 'read', sid, '/work/missing.txt', { observation: { kind: 'absent' } })

    // 6. client-reported sidebar write → create
    const rec = await callRoute(getRoute, 'POST', '/file-activity/api/record', {
      sessionId: sid,
      path: '/work/c.txt',
      op: 'write',
    })
    assert.equal(rec.status, 200, 'record route status')

    // 7. stats
    const stats = await callRoute(getRoute, 'GET', `/file-activity/api/stats?sessionId=${sid}`)
    assert.equal(stats.status, 200)
    const value = stats.json.value
    assert.equal(value.counts['/work/a.txt'].read, 2, 'a.txt reads')
    assert.equal(value.counts['/work/a.txt'].modify, 1, 'a.txt modifies')
    assert.equal(value.counts['/work/b.txt'].create, 1, 'b.txt creates')
    assert.equal(value.counts['/work/b.txt'].modify, 1, 'b.txt modifies')
    assert.equal(value.counts['/work/c.txt'].create, 1, 'c.txt create via route')
    assert.equal(value.counts['/work/missing.txt'], undefined, 'absent ignored')
    assert.equal(value.recent.length, 3, 'recent records (LRU dedup: a.txt×2, b.txt×2, a.txt edit, c.txt)')
    assert.equal(value.recent[0].path, '/work/c.txt', 'most recent first')
    assert.equal(value.recent.filter((e) => e.path === '/work/a.txt').length, 1, 'a.txt appears once in recent')
    assert.equal(value.recent.filter((e) => e.path === '/work/b.txt').length, 1, 'b.txt appears once in recent')

    // 7b. firstSeen / lastSeen tracked per file
    const aCounts = value.counts['/work/a.txt']
    const bCounts = value.counts['/work/b.txt']
    assert.equal(typeof aCounts.firstSeen, 'number', 'a.txt firstSeen present')
    assert.equal(typeof aCounts.lastSeen, 'number', 'a.txt lastSeen present')
    assert.equal(typeof bCounts.firstSeen, 'number', 'b.txt firstSeen present')
    assert.ok(aCounts.lastSeen >= aCounts.firstSeen, 'a.txt lastSeen >= firstSeen')
    assert.ok(bCounts.lastSeen >= bCounts.firstSeen, 'b.txt lastSeen >= firstSeen (create then modify)')

    // 7c. recent history capped at RECENT_LIMIT (5, LRU)
    for (let i = 0; i < 12; i++) {
      emitObserved(ctx, 'read', sid, `/work/cap-${i}.txt`)
    }
    const capped = await callRoute(getRoute, 'GET', `/file-activity/api/stats?sessionId=${sid}`)
    assert.equal(capped.json.value.recent.length, 5, 'recent capped at 5 (LRU)')
    assert.equal(capped.json.value.recent[0].path, '/work/cap-11.txt', 'newest entry kept')
    assert.equal(capped.json.value.counts['/work/cap-0.txt'].read, 1, 'capped file still counted')
    assert.equal(
      typeof capped.json.value.counts['/work/cap-0.txt'].firstSeen,
      'number',
      'capped file firstSeen present',
    )

    // 8. persistence file written (debounced 500ms → wait)
    await new Promise((resolve) => setTimeout(resolve, 800))
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(persisted.sessions[sid].counts['/work/b.txt'].create, 1, 'persisted creates')

    // 8b. RESTART RECOVERY: a fresh plugin instance (simulating a DSH restart)
    // must load the persisted state and serve the same per-session data.
    const { ctx: ctxRestarted, getRoute: getRouteRestarted, getMediaRoute: getMediaRestarted } = await boot()
    const restarted = await callRoute(getRouteRestarted, 'GET', `/file-activity/api/stats?sessionId=${sid}`)
    assert.equal(restarted.status, 200, 'stats served after restart')
    assert.equal(restarted.json.value.counts['/work/a.txt'].read, 2, 'a.txt reads survive restart')
    assert.equal(restarted.json.value.counts['/work/a.txt'].modify, 1, 'a.txt modifies survive restart')
    assert.equal(restarted.json.value.counts['/work/b.txt'].create, 1, 'b.txt creates survive restart')
    assert.equal(restarted.json.value.counts['/work/b.txt'].modify, 1, 'b.txt modifies survive restart')
    assert.equal(restarted.json.value.counts['/work/c.txt'].create, 1, 'c.txt create survives restart')
    assert.equal(restarted.json.value.recent.length, 5, 'recent history survives restart (LRU cap)')
    assert.equal(restarted.json.value.recent[0].path, '/work/cap-11.txt', 'newest entry survives restart')

    // 8c. MEDIA ROUTE: a file recorded OUTSIDE the session cwd (e.g. /tmp) must
    // preview — the sidebar's /sidebar/file would 403 it, /file-activity/file
    // authorizes exactly the recorded paths and serves the bytes.
    const mediaFile = join(tmpdir(), `dfa-media-${Date.now()}.png`)
    const mediaBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeFileSync(mediaFile, mediaBytes)
    emitObserved(ctxRestarted, 'read', sid, mediaFile)
    const media = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=${sid}&path=${encodeURIComponent(mediaFile)}`,
    )
    assert.equal(media.status, 200, 'recorded outside-cwd file served')
    assert.equal(media.headers['content-type'], 'image/png', 'image/png content type')
    assert.ok(
      Buffer.isBuffer(media.body) ? media.body.equals(mediaBytes) : media.body === mediaBytes.toString('utf8'),
      'exact bytes served',
    )
    const mediaDl = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=${sid}&path=${encodeURIComponent(mediaFile)}&download=1`,
    )
    assert.equal(mediaDl.status, 200, 'download variant served')
    assert.ok(String(mediaDl.headers['content-disposition']).startsWith('attachment'), 'content-disposition attachment')

    // 8d. MEDIA ROUTE refuses: unrecorded paths (403), deleted files (404),
    // missing parameters (400).
    const unrecorded = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=${sid}&path=${encodeURIComponent('/work/never-touched.png')}`,
    )
    assert.equal(unrecorded.status, 403, 'unrecorded path refused')
    assert.equal(JSON.parse(unrecorded.body).ok, false, 'unrecorded path JSON error')
    emitObserved(ctxRestarted, 'read', sid, '/work/ghost.png')
    const ghost = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=${sid}&path=${encodeURIComponent('/work/ghost.png')}`,
    )
    assert.equal(ghost.status, 404, 'recorded but missing file → 404')
    assert.equal(JSON.parse(ghost.body).ok, false, 'missing file JSON error')
    const noParam = await callMedia(getMediaRestarted, 'GET', '/file-activity/file?sessionId=')
    assert.equal(noParam.status, 400, 'missing path → 400')
    assert.equal(JSON.parse(noParam.body).ok, false, 'missing path JSON error')
    const foreignSession = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=other-session&path=${encodeURIComponent(mediaFile)}`,
    )
    assert.equal(foreignSession.status, 403, "other session cannot read this session's media")
    assert.equal(JSON.parse(foreignSession.body).ok, false, 'foreign session JSON error')

    // 8e. TEXT ROUTE (issue #68): a recorded text file OUTSIDE the session cwd
    // must be readable via ?as=text — the sidebar fs.read refuses such paths
    // (workspace fence), so the floating preview falls back to this route,
    // which returns an fs.read-shaped JSON payload: { ok, value: { content } }.
    const textFile = join(tmpdir(), `dfa-text-${Date.now()}.md`)
    const textContent = `# issue body\n\noutside-workspace text ${Date.now()}`
    writeFileSync(textFile, textContent)
    emitObserved(ctxRestarted, 'read', sid, textFile)
    const text = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=${sid}&path=${encodeURIComponent(textFile)}&as=text`,
    )
    assert.equal(text.status, 200, 'recorded outside-cwd text served via as=text')
    const textJson = JSON.parse(text.body)
    assert.equal(textJson.ok, true, 'as=text JSON ok flag')
    assert.equal(textJson.value.content, textContent, 'as=text returns the exact text content')
    // as=text refuses: unrecorded paths (403) and recorded-but-deleted files (404).
    const textUnrecorded = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=${sid}&path=${encodeURIComponent('/work/never-touched.md')}&as=text`,
    )
    assert.equal(textUnrecorded.status, 403, 'as=text unrecorded path refused')
    emitObserved(ctxRestarted, 'read', sid, '/work/ghost-text.md')
    const textGhost = await callMedia(
      getMediaRestarted,
      'GET',
      `/file-activity/file?sessionId=${sid}&path=${encodeURIComponent('/work/ghost-text.md')}&as=text`,
    )
    assert.equal(textGhost.status, 404, 'as=text recorded but missing file → 404')
    assert.equal(JSON.parse(textGhost.body).ok, false, 'as=text missing file JSON error')

    // 9. unknown route → 404
    const nf = await callRoute(getRouteRestarted, 'GET', '/file-activity/api/nope')
    assert.equal(nf.status, 404)
    assert.equal(nf.json.ok, false, 'unknown method body ok false')

    // 10. clear route
    const clr = await callRoute(getRouteRestarted, 'POST', '/file-activity/api/clear', {
      sessionId: sid,
    })
    assert.equal(clr.status, 200)
    assert.equal(clr.json.ok, true, 'clear body ok true')
    const after = await callRoute(getRouteRestarted, 'GET', `/file-activity/api/stats?sessionId=${sid}`)
    assert.deepEqual(after.json.value.counts, {}, 'cleared counts')

    // 11. persisted history longer than the cap is trimmed on load (and
    // duplicate paths are deduped)
    // (wait out the clear's debounced persist first, then seed an oversized file)
    await new Promise((resolve) => setTimeout(resolve, 600))
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        sessions: {
          'session-2': {
            known: {},
            counts: {},
            recent: [
              ...Array.from({ length: 15 }, (_, i) => ({
                path: `/work/old-${14 - i}.txt`,
                op: 'read',
                time: 1000 + (14 - i),
              })),
              { path: '/work/old-10.txt', op: 'read', time: 999 },
            ],
          },
        },
      }),
      'utf8',
    )
    const { getRoute: getRoute2 } = await boot()
    const trimmed = await callRoute(getRoute2, 'GET', '/file-activity/api/stats?sessionId=session-2')
    assert.equal(trimmed.json.value.recent.length, 5, 'pre-existing history trimmed to 5 on load')
    assert.equal(trimmed.json.value.recent[0].path, '/work/old-14.txt', 'newest entry kept after trim')
    assert.equal(
      trimmed.json.value.recent.filter((e) => e.path === '/work/old-10.txt').length,
      1,
      'duplicate path deduped on load',
    )

    // ── plugin:status-query returns file-activity state ──────────────────────
    {
      const { ctx: ctxStatus } = await boot()
      const sid = 'status-query-session'
      // record some activity so stats are non-trivial
      emitObserved(ctxStatus, 'create_file', sid, '/work/status-query.txt')
      await new Promise((resolve) => setTimeout(resolve, 50))
      const ev = ctxStatus.events.find((e) => e.name === 'plugin:status-query')
      assert.ok(ev, 'status-query handler registered')
      const result = ev.listener({ plugin: 'dsh-file-activity' })
      assert.equal(result?.ok, true)
      assert.equal(result?.value?.plugin, 'dsh-file-activity')
      assert.equal(result?.value?.running, true)
      assert.equal(typeof result?.value?.stats?.totalFiles, 'number')
      assert.ok(result.value.stats.totalFiles >= 1, 'totalFiles reflects recorded activity')
      assert.ok(Array.isArray(result.value.lastActions), 'lastActions is array')
      assert.ok(result.value.lastActions.length >= 1, 'lastActions has entries')
      assert.equal(result.value.lastActions[0].detail, '/work/status-query.txt')
      assert.deepEqual(result.value.config, { keys: [] })
      // wrong plugin name returns undefined
      assert.equal(ev.listener({ plugin: 'other' }), undefined)
    }

    console.log('ALL HOST SMOKE TESTS PASSED')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
