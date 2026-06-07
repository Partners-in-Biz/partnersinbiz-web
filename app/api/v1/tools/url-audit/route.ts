import { NextRequest, NextResponse } from 'next/server'
import { checkAndIncrementRateLimit } from '@/lib/rateLimit'
import { runUrlAudit, type UrlAuditKind } from '@/lib/tools/url-audit'

const AUDIT_KINDS = new Set<UrlAuditKind>(['metadata', 'robots', 'sitemap'])

function getRequestIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: NextRequest) {
  let body: { url?: unknown; kind?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url : ''
  const kind = typeof body.kind === 'string' && AUDIT_KINDS.has(body.kind as UrlAuditKind)
    ? body.kind as UrlAuditKind
    : null

  if (!url.trim()) return NextResponse.json({ ok: false, error: 'URL is required.' }, { status: 400 })
  if (!kind) return NextResponse.json({ ok: false, error: 'Unsupported audit kind.' }, { status: 400 })

  try {
    const ip = getRequestIp(req)
    const limit = await checkAndIncrementRateLimit({
      key: `public_tool_url_audit:${kind}:${ip}`,
      limit: 12,
      windowMs: 60 * 60 * 1000,
    })

    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Too many checks. Please try again later.', resetAt: limit.resetAt.toISOString() },
        { status: 429 },
      )
    }
  } catch {
    // If the durable limiter is unavailable, keep the checker usable but rely on SSRF, timeout, redirect, and size guards below.
  }

  try {
    const result = await runUrlAudit(url, kind)
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The checker could not read that URL.'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
