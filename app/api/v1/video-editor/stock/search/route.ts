import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { normalizePexelsResults, normalizePixabayResults, type StockResult } from '@/lib/video-editor/stock'

export const dynamic = 'force-dynamic'

type StockSearchKind = 'image' | 'video' | 'all'
type CacheEntry = { expiresAt: number; results: StockResult[] }

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
const cache = new Map<string, CacheEntry>()

function normalizeKind(value: string | null): StockSearchKind {
  return value === 'image' || value === 'video' || value === 'all' ? value : 'all'
}

function cacheKey(q: string, kind: StockSearchKind, page: number): string {
  return `${q.toLowerCase()}:${kind}:${page}`
}

function getCached(key: string): StockResult[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  cache.delete(key)
  cache.set(key, entry)
  return entry.results
}

function setCached(key: string, results: StockResult[]) {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, results })
  while (cache.size > MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value
    if (!first) break
    cache.delete(first)
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`Stock provider returned ${res.status}`)
  return res.json()
}

function pexelsCalls(q: string, kind: StockSearchKind, page: number): Array<Promise<StockResult[]>> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return []
  const headers = { Authorization: key }
  const calls: Array<Promise<StockResult[]>> = []
  if (kind === 'image' || kind === 'all') {
    const params = new URLSearchParams({ query: q, page: String(page), per_page: '12' })
    calls.push(fetchJson(`https://api.pexels.com/v1/search?${params.toString()}`, { headers })
      .then((body) => normalizePexelsResults(body as Parameters<typeof normalizePexelsResults>[0])))
  }
  if (kind === 'video' || kind === 'all') {
    const params = new URLSearchParams({ query: q, page: String(page), per_page: '12' })
    calls.push(fetchJson(`https://api.pexels.com/videos/search?${params.toString()}`, { headers })
      .then((body) => normalizePexelsResults(body as Parameters<typeof normalizePexelsResults>[0])))
  }
  return calls
}

function pixabayCalls(q: string, kind: StockSearchKind, page: number): Array<Promise<StockResult[]>> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return []
  const calls: Array<Promise<StockResult[]>> = []
  if (kind === 'image' || kind === 'all') {
    const params = new URLSearchParams({ key, q, page: String(page), per_page: '12', safesearch: 'true' })
    calls.push(fetchJson(`https://pixabay.com/api/?${params.toString()}`)
      .then((body) => normalizePixabayResults(body as Parameters<typeof normalizePixabayResults>[0])))
  }
  if (kind === 'video' || kind === 'all') {
    const params = new URLSearchParams({ key, q, page: String(page), per_page: '12', safesearch: 'true' })
    calls.push(fetchJson(`https://pixabay.com/api/videos/?${params.toString()}`)
      .then((body) => normalizePixabayResults(body as Parameters<typeof normalizePixabayResults>[0])))
  }
  return calls
}

export const GET = withAuth('client', async (req: NextRequest) => {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (!q) return apiError('q is required', 400)
  const kind = normalizeKind(url.searchParams.get('kind'))
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const key = cacheKey(q, kind, page)
  const cached = getCached(key)
  if (cached) return apiSuccess({ results: cached })

  const settled = await Promise.allSettled([
    ...pexelsCalls(q, kind, page),
    ...pixabayCalls(q, kind, page),
  ])
  const results = settled.flatMap((entry) => entry.status === 'fulfilled' ? entry.value : [])
  setCached(key, results)
  return apiSuccess({ results })
})
