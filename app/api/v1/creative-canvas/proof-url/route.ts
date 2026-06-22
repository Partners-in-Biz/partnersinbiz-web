import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type ProofUrlCheck = {
  url: string
  reachable: boolean
  status?: number
  contentType?: string
  checkedAt: string
  signalMatched?: boolean
  signalCheckedAt?: string
  missingSignals?: string[]
}

type ProofUrlKind = 'image' | 'evidence'

function parseHttpProofUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost'
      || host === '0.0.0.0'
      || host === '127.0.0.1'
      || host.endsWith('.local')
      || host.endsWith('.internal')
    ) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function proofResponse(url: string, response: Response, checkedAt: string, kind: ProofUrlKind): ProofUrlCheck {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || undefined
  const statusReachable = response.status >= 200 && response.status < 400
  return {
    url,
    reachable: kind === 'image'
      ? statusReachable && Boolean(contentType?.startsWith('image/'))
      : statusReachable,
    status: response.status,
    contentType,
    checkedAt,
  }
}

function cleanExpectedSignals(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)))
}

function normalizeSignalText(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function checkExpectedSignals(url: string, expectedSignals: string[]): Promise<Pick<ProofUrlCheck, 'signalMatched' | 'signalCheckedAt' | 'missingSignals'>> {
  if (!expectedSignals.length) return {}
  const signalCheckedAt = new Date().toISOString()
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    if (response.status < 200 || response.status >= 400) {
      return { signalMatched: false, signalCheckedAt, missingSignals: expectedSignals }
    }
    const pageText = normalizeSignalText((await response.text()).slice(0, 350_000))
    const missingSignals = expectedSignals.filter((signal) => !pageText.includes(normalizeSignalText(signal)))
    return {
      signalMatched: missingSignals.length === 0,
      signalCheckedAt,
      missingSignals,
    }
  } catch {
    return { signalMatched: false, signalCheckedAt, missingSignals: expectedSignals }
  }
}

async function checkProofUrl(url: string, kind: ProofUrlKind, expectedSignals: string[]): Promise<ProofUrlCheck> {
  const checkedAt = new Date().toISOString()
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    if (head.status !== 405) {
      const proof = proofResponse(url, head, checkedAt, kind)
      if (proof.reachable && kind === 'evidence') {
        return { ...proof, ...(await checkExpectedSignals(url, expectedSignals)) }
      }
      return proof
    }
  } catch {
    // Fall through to a tiny GET because some storage/CDN hosts reject HEAD.
  }

  try {
    const get = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    const proof = proofResponse(url, get, checkedAt, kind)
    if (proof.reachable && kind === 'evidence') {
      return { ...proof, ...(await checkExpectedSignals(url, expectedSignals)) }
    }
    return proof
  } catch {
    return { url, reachable: false, checkedAt }
  }
}

export const POST = withAuth('client', async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  const proofUrl = parseHttpProofUrl(body?.url)
  if (!proofUrl) return apiError('A public http(s) proof URL is required', 400)
  const kind: ProofUrlKind = body?.kind === 'evidence' ? 'evidence' : 'image'
  const result = await checkProofUrl(proofUrl, kind, cleanExpectedSignals(body?.expectedSignals))
  return apiSuccess({ proof: result })
})
