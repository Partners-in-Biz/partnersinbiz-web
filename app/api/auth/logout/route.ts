import { NextRequest, NextResponse } from 'next/server'
import { enforcePublicRateLimit, publicRequestIp } from '@/lib/api/public-rate-limit'

async function clearSessionAndRedirect(request: NextRequest) {
  // PUBLIC: clears the browser session cookie and redirects to the public home page.
  const limited = await enforcePublicRateLimit(request, {
    key: `auth_logout:${publicRequestIp(request)}`,
    limit: 60,
    windowMs: 15 * 60 * 1000,
  })
  if (limited) return limited

  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const response = NextResponse.redirect(new URL('/', request.url))
  response.cookies.set(cookieName, '', { maxAge: 0, path: '/' })
  return response
}

export async function GET(request: NextRequest) {
  return clearSessionAndRedirect(request)
}

export async function POST(request: NextRequest) {
  return clearSessionAndRedirect(request)
}
