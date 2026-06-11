import { resolveShortCode, trackClick } from '@/lib/links/shorten'
import { enforcePublicRateLimit, publicRequestIp } from '@/lib/api/public-rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /l/[code]
 * PUBLIC: redirect endpoint, no authentication required.
 * Looks up the short code, tracks the click, and redirects
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await context.params

  // Validate short code format (alphanumeric only)
  if (!/^[a-zA-Z0-9]{6,8}$/.test(code)) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/' },
    })
  }
  const limited = await enforcePublicRateLimit(req, {
    key: `shortlink:${code}:${publicRequestIp(req)}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return limited

  const resolved = await resolveShortCode(code)
  if (!resolved) {
    // Link not found — redirect to homepage
    return new Response(null, {
      status: 302,
      headers: { Location: '/' },
    })
  }

  // Track the click (fire-and-forget, don't await)
  trackClick(resolved.linkId, resolved.orgId, req, {
    contactId: resolved.contactId,
    destinationUrl: resolved.url,
  }).catch(() => {})

  // Redirect to the original URL with UTM params
  return new Response(null, {
    status: 302,
    headers: { Location: resolved.url },
  })
}
