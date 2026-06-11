/**
 * POST /api/integrations/play_console/webhook/[propertyId] — PUBLIC
 *
 * Receives Real-time Developer Notifications (RTDN) from Google Play.
 * The customer configures a Pub/Sub push subscription that targets this
 * URL. The body is the standard Pub/Sub push envelope:
 *
 *   { "message": { "data": "<base64 JSON RTDN>", "messageId": "...", "publishTime": "..." } }
 *
 * IMPORTANT: always return 200 quickly — Pub/Sub retries non-2xx
 * aggressively. All handling errors are logged and swallowed.
 *
 * Optional auth: if `RTDN_SHARED_SECRET` is set, we require the request
 * carry it as a `?token=` query param so a randomly guessed URL cannot
 * inject metric rows. Recommended in production.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAdapterOrThrow } from '@/lib/integrations/registry'
import { enforcePublicRateLimit, publicRequestIp } from '@/lib/api/public-rate-limit'
// Side-effect import to register the play_console adapter.
import '@/lib/integrations/play_console'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ propertyId: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { propertyId } = await ctx.params
  const limited = await enforcePublicRateLimit(req, {
    key: `play_console_rtdn:${propertyId}:${publicRequestIp(req)}`,
    limit: 240,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return limited

  // PUBLIC: Google Play RTDN webhook. Production fails closed unless shared-secret verification is configured.
  const expectedToken = process.env.RTDN_SHARED_SECRET
  if (expectedToken) {
    const token = req.nextUrl.searchParams.get('token')
    if (token !== expectedToken) {
      // Return 200 anyway so a probing scanner can't enumerate URLs.
      return NextResponse.json({ received: true, verified: false }, { status: 200 })
    }
  } else if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    console.error('[play_console webhook] RTDN_SHARED_SECRET is not set — rejecting production webhook')
    return NextResponse.json({ received: false, verified: false }, { status: 403 })
  }

  let rawBody = ''
  try {
    rawBody = await req.text()
  } catch (err) {
    console.error('[play_console webhook] failed to read body:', err)
    return NextResponse.json({ received: true }, { status: 200 })
  }

  // Build a flat headers map; the adapter expects strings.
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v
  })
  // Inject the propertyId so the adapter's handleWebhook can route the event.
  headers['x-pib-property-id'] = propertyId

  try {
    const adapter = getAdapterOrThrow('play_console')
    if (!adapter.handleWebhook) {
      console.error('[play_console webhook] adapter has no handleWebhook')
      return NextResponse.json({ received: true }, { status: 200 })
    }
    const result = await adapter.handleWebhook({ rawBody, headers })
    return NextResponse.json(
      {
        received: true,
        metricsWritten: result.metricsWritten,
        notes: result.notes ?? [],
      },
      { status: result.status ?? 200 },
    )
  } catch (err) {
    console.error('[play_console webhook] handler error:', err)
    return NextResponse.json({ received: true }, { status: 200 })
  }
}
