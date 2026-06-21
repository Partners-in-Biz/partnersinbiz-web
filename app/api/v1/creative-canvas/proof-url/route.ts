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
}

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

function proofResponse(url: string, response: Response, checkedAt: string): ProofUrlCheck {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || undefined
  return {
    url,
    reachable: response.status >= 200 && response.status < 400 && Boolean(contentType?.startsWith('image/')),
    status: response.status,
    contentType,
    checkedAt,
  }
}

async function checkProofUrl(url: string): Promise<ProofUrlCheck> {
  const checkedAt = new Date().toISOString()
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    if (head.status !== 405) return proofResponse(url, head, checkedAt)
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
    return proofResponse(url, get, checkedAt)
  } catch {
    return { url, reachable: false, checkedAt }
  }
}

export const POST = withAuth('client', async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  const proofUrl = parseHttpProofUrl(body?.url)
  if (!proofUrl) return apiError('A public http(s) proof URL is required', 400)
  const result = await checkProofUrl(proofUrl)
  return apiSuccess({ proof: result })
})
