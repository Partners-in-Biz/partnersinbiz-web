// app/api/v1/auth/magic-link/verify/route.ts
//
// PUBLIC endpoint hit from the email link. Consumes the single-use token,
// finds-or-creates the Firebase user, mints a custom token, and redirects to a
// client landing page that completes the sign-in dance:
//
//   1. /auth/magic-link/verify?customToken=X&redirect=Y
//   2. Landing page calls Firebase JS SDK `signInWithCustomToken(customToken)`
//   3. Landing page POSTs the resulting ID token to /api/v1/auth/session
//   4. /api/v1/auth/session sets the `__session` cookie and the user is in
//
// Why this two-step dance: `adminAuth.createSessionCookie` requires a real
// signed-in ID token (from a client that has authenticated to Firebase), not a
// custom token. So we mint a custom token here, hand it to the browser, and
// let the browser exchange it for an ID token before we can mint a session
// cookie. Established PiB pattern — see app/api/auth/session/route.ts.
//
// Errors redirect to /auth/magic-link/error?reason=<X>
//   - missing_token: no token query param
//   - not_found / expired / used: returned by consumeMagicLink

import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { consumeMagicLink } from '@/lib/client-documents/magicLink'
import { findOrCreateGuestUser } from '@/lib/auth/guestUser'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'
import { markPendingLegalAcceptanceForLogin } from '@/lib/governance/legal-acceptance'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // PUBLIC: magic-link email callback that consumes a single-use token.
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/auth/magic-link/error?reason=missing_token', req.url))
  }
  const ipLimited = await enforcePublicRateLimit(req, {
    key: `magic_link_verify:${publicRequestIp(req)}`,
    limit: 30,
    windowMs: 15 * 60 * 1000,
  })
  if (ipLimited) return ipLimited

  const tokenLimited = await enforcePublicRateLimit(req, {
    key: `magic_link_verify_token:${publicRateLimitHash(token)}`,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  })
  if (tokenLimited) return tokenLimited

  const result = await consumeMagicLink(token)
  if (!result.ok) {
    const reason = result.reason ?? 'not_found'
    return NextResponse.redirect(new URL(`/auth/magic-link/error?reason=${reason}`, req.url))
  }

  if (!result.email) {
    // Defensive — consumeMagicLink should always return email on ok:true, but
    // guard anyway so we never mint tokens for empty addresses.
    return NextResponse.redirect(new URL('/auth/magic-link/error?reason=not_found', req.url))
  }

  const user = await findOrCreateGuestUser(result.email, 'magic_link')
  await markPendingLegalAcceptanceForLogin({ uid: user.uid, email: result.email })
  const customToken = await adminAuth.createCustomToken(user.uid)

  // The landing page exchanges customToken -> idToken via signInWithCustomToken
  // then POSTs the idToken to /api/v1/auth/session to set the cookie.
  const redirectTo = result.redirectUrl ?? '/'
  const landingUrl = new URL('/auth/magic-link/verify', req.url)
  landingUrl.searchParams.set('customToken', customToken)
  landingUrl.searchParams.set('redirect', redirectTo)

  return NextResponse.redirect(landingUrl)
}
