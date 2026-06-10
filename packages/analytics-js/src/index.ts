export interface InitOptions {
  ingestKey: string
  propertyId: string
  host?: string
  batchSize?: number
  flushInterval?: number
}

interface Config {
  ingestKey: string
  propertyId: string
  host: string
  batchSize: number
  flushInterval: number
}

interface EventPayload {
  event: string
  distinctId: string
  sessionId: string
  userId: string | null
  properties: Record<string, unknown>
  timestamp: string
  pageUrl: string | null
  referrer: string | null
  userAgent: string | null
  utm: Record<string, string>
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000

let _config: Config | null = null
const _queue: EventPayload[] = []
let _flushTimer: ReturnType<typeof setTimeout> | null = null
let _userId: string | null = null

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function getDistinctId(): string {
  if (!isBrowser()) return 'server'
  let id = localStorage.getItem('_pib_did')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('_pib_did', id)
  }
  return id
}

function getSessionId(): string {
  if (!isBrowser()) return 'server-session'
  const lastActivity = parseInt(localStorage.getItem('_pib_last') ?? '0', 10)
  const now = Date.now()
  let sid = localStorage.getItem('_pib_sid')
  if (!sid || (now - lastActivity) > SESSION_TIMEOUT_MS) {
    sid = crypto.randomUUID()
    localStorage.setItem('_pib_sid', sid)
  }
  localStorage.setItem('_pib_last', String(now))
  return sid
}

function getUtm(): Record<string, string> {
  if (!isBrowser()) return {}
  const params = new URLSearchParams(window.location.search)
  const utm: Record<string, string> = {}
  for (const key of ['source', 'medium', 'campaign', 'content', 'term']) {
    const val = params.get(`utm_${key}`)
    if (val) utm[key] = val
  }
  return utm
}

async function flush(): Promise<void> {
  if (!_config || _queue.length === 0) return
  const batch = _queue.splice(0, _config.batchSize)
  try {
    await fetch(`${_config.host}/api/v1/analytics/ingest`, {
      method: 'POST',
      headers: {
        'x-pib-ingest-key': _config.ingestKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ propertyId: _config.propertyId, events: batch }),
      keepalive: true,
    })
  } catch {
    // Never throw — analytics must never break the host app
  }
}

function scheduleFlush(): void {
  if (!_config || _flushTimer) return
  _flushTimer = setTimeout(() => {
    _flushTimer = null
    void flush()
  }, _config.flushInterval)
}

function enqueue(payload: EventPayload): void {
  if (!_config) return
  _queue.push(payload)
  if (_queue.length >= _config.batchSize) {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
    void flush()
  } else {
    scheduleFlush()
  }
}

export function init(options: InitOptions): void {
  _config = {
    host: 'https://app.partnersinbiz.online',
    batchSize: 10,
    flushInterval: 5000,
    ...options,
  }

  if (isBrowser()) {
    const originalPush = history.pushState.bind(history)
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      originalPush(...args)
      track('$pageview')
    }
    window.addEventListener('popstate', () => track('$pageview'))
    window.addEventListener('pagehide', () => { void flush() })
    track('$pageview')
  }
}

export function track(event: string, properties: Record<string, unknown> = {}): void {
  if (!_config) return
  enqueue({
    event,
    distinctId: getDistinctId(),
    sessionId: getSessionId(),
    userId: _userId,
    properties,
    timestamp: new Date().toISOString(),
    pageUrl: isBrowser() ? window.location.href : null,
    referrer: isBrowser() ? (document.referrer || null) : null,
    userAgent: isBrowser() ? navigator.userAgent : null,
    utm: getUtm(),
  })
}

export function identify(userId: string, traits: Record<string, unknown> = {}): void {
  if (!_config) return
  _userId = userId
  track('$identify', { userId, ...traits })
}

export function page(properties: Record<string, unknown> = {}): void {
  track('$pageview', properties)
}
