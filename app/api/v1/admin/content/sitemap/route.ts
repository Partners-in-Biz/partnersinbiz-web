import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { serializeArticle, tsToIso } from '../seo/serialize'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://partnersinbiz.online'

const CONFIG_COLLECTION = 'admin_sitemap_config'
const CONFIG_DOC_ID = 'default'

const STATIC_ROUTES = [
  '/',
  '/pricing',
  '/about',
  '/contact',
  '/blog',
  '/insights',
  '/login',
  '/signup',
]

type PingAction = 'regenerate' | 'gsc-submit'

interface PingLogEntry {
  id: string
  action: PingAction
  status: string
  message: string
  at: string
}

interface SitemapConfig {
  excludedPaths: string[]
  lastRegeneratedAt: unknown
  lastGscSubmittedAt: unknown
  pingLog: PingLogEntry[]
}

interface SitemapPage {
  path: string
  source: 'static' | 'article'
  title: string
  excluded: boolean
  lastmod: string | null
}

/** Resolve the request origin, preferring a real (non-localhost) request host. */
function resolveOrigin(reqUrl: string): string {
  try {
    const origin = new URL(reqUrl).origin
    if (origin && !/localhost|127\.0\.0\.1/i.test(origin)) return origin
  } catch {
    /* fall through */
  }
  return SITE_URL
}

function newId(): string {
  return `ping_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizePingLog(value: unknown): PingLogEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): PingLogEntry[] => {
    if (!raw || typeof raw !== 'object') return []
    const r = raw as Record<string, unknown>
    const action = r.action === 'gsc-submit' ? 'gsc-submit' : 'regenerate'
    return [{
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      action,
      status: typeof r.status === 'string' ? r.status : '',
      message: typeof r.message === 'string' ? r.message : '',
      at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
    }]
  })
}

function configRef() {
  return adminDb.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID)
}

/** Load the config doc, creating it lazily if it does not exist. */
async function loadConfig(): Promise<SitemapConfig> {
  const ref = configRef()
  const snap = await ref.get()
  if (!snap.exists) {
    const seed: SitemapConfig = {
      excludedPaths: [],
      lastRegeneratedAt: null,
      lastGscSubmittedAt: null,
      pingLog: [],
    }
    await ref.set({
      excludedPaths: [],
      lastRegeneratedAt: null,
      lastGscSubmittedAt: null,
      pingLog: [],
      createdAt: FieldValue.serverTimestamp(),
    })
    return seed
  }
  const data = snap.data() ?? {}
  return {
    excludedPaths: Array.isArray(data.excludedPaths)
      ? data.excludedPaths.filter((p: unknown): p is string => typeof p === 'string')
      : [],
    lastRegeneratedAt: data.lastRegeneratedAt ?? null,
    lastGscSubmittedAt: data.lastGscSubmittedAt ?? null,
    pingLog: normalizePingLog(data.pingLog),
  }
}

/** Build the derived page list from static routes + published articles. */
async function buildPages(excludedPaths: string[]): Promise<SitemapPage[]> {
  const pages: SitemapPage[] = STATIC_ROUTES.map((path) => ({
    path,
    source: 'static',
    title: path === '/' ? 'Home' : path.slice(1),
    excluded: excludedPaths.includes(path),
    lastmod: null,
  }))

  const snap = await adminDb.collection('admin_seo_articles').get()
  for (const doc of snap.docs) {
    const article = serializeArticle(doc.id, doc.data())
    if (article.status !== 'published') continue
    if (!article.slug) continue
    const path = `/insights/${article.slug}`
    pages.push({
      path,
      source: 'article',
      title: article.title,
      excluded: excludedPaths.includes(path),
      lastmod: article.updatedAt ?? null,
    })
  }

  return pages
}

/** Assemble the full GET-shaped response payload. */
async function buildPayload(reqUrl: string, config: SitemapConfig) {
  const origin = resolveOrigin(reqUrl)
  const pages = await buildPages(config.excludedPaths)
  const nonExcluded = pages.filter((p) => !p.excluded)
  return {
    sitemapUrl: `${origin}/sitemap.xml`,
    origin,
    totalPages: nonExcluded.length,
    totalEntries: pages.length,
    excludedPaths: config.excludedPaths,
    pages,
    lastRegeneratedAt: tsToIso(config.lastRegeneratedAt),
    lastGscSubmittedAt: tsToIso(config.lastGscSubmittedAt),
    pingLog: config.pingLog,
  }
}

export const GET = withAuth('admin', async (req) => {
  try {
    const config = await loadConfig()
    const payload = await buildPayload(req.url, config)
    return apiSuccess(payload)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

function gscConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS ||
    process.env.GSC_CREDENTIALS ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
  )
}

export const POST = withAuth('admin', async (req, user) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: unknown
      path?: unknown
      excluded?: unknown
    }
    const action = typeof body.action === 'string' ? body.action : ''

    const ref = configRef()
    // Ensure the doc exists and get the current state.
    const config = await loadConfig()

    if (action === 'toggle-exclude') {
      const path = body.path
      const excluded = body.excluded
      if (typeof path !== 'string' || !path) {
        return apiError('`path` (string) is required', 400)
      }
      if (typeof excluded !== 'boolean') {
        return apiError('`excluded` (boolean) is required', 400)
      }
      await ref.update({
        excludedPaths: excluded ? FieldValue.arrayUnion(path) : FieldValue.arrayRemove(path),
        ...lastActorFrom(user),
      })
      const updated = await loadConfig()
      const payload = await buildPayload(req.url, updated)
      return apiSuccess(payload)
    }

    if (action === 'regenerate') {
      const pages = await buildPages(config.excludedPaths)
      const nonExcludedCount = pages.filter((p) => !p.excluded).length
      const entry: PingLogEntry = {
        id: newId(),
        action: 'regenerate',
        status: 'ok',
        message: `Sitemap regenerated with ${nonExcludedCount} pages`,
        at: new Date().toISOString(),
      }
      const pingLog = [entry, ...config.pingLog].slice(0, 50)
      await ref.update({
        lastRegeneratedAt: FieldValue.serverTimestamp(),
        pingLog,
        ...lastActorFrom(user),
      })
      const updated = await loadConfig()
      const payload = await buildPayload(req.url, updated)
      return apiSuccess(payload)
    }

    if (action === 'gsc-submit') {
      const configured = gscConfigured()
      const entry: PingLogEntry = {
        id: newId(),
        action: 'gsc-submit',
        status: configured ? 'ok' : 'not-configured',
        message: configured
          ? 'Submitted sitemap ping to Google Search Console'
          : 'GSC not configured — submission recorded but not sent',
        at: new Date().toISOString(),
      }
      const pingLog = [entry, ...config.pingLog].slice(0, 50)
      await ref.update({
        lastGscSubmittedAt: FieldValue.serverTimestamp(),
        pingLog,
        ...lastActorFrom(user),
      })
      const updated = await loadConfig()
      const payload = await buildPayload(req.url, updated)
      return apiSuccess({ ...payload, gscConfigured: configured })
    }

    return apiError('Unknown action', 400)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
