import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? '__session'
const MARKET_COOKIE = 'pib-market'

const PROTECTED = ['/portal', '/admin']

export default async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // Geo-routing: redirect US visitors on homepage to /us
  if (pathname === '/') {
    // Next.js 16 dropped `NextRequest.geo`; Vercel still stamps the country header.
    const country = request.headers.get('x-vercel-ip-country')
    const marketCookie = request.cookies.get(MARKET_COOKIE)?.value
    const homeQuery = searchParams.get('home')

    // Skip redirect if global market cookie is set or ?home=1 query parameter
    const skipRedirect = marketCookie === 'global' || homeQuery === '1'

    if (country === 'US' && !skipRedirect) {
      const response = NextResponse.redirect(new URL('/us', request.url), 307)
      response.cookies.set(MARKET_COOKIE, 'us', {
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
        sameSite: 'lax',
      })
      return response
    }

    // If ?home=1 is present, set the global market cookie so user isn't redirected again
    if (homeQuery === '1' && country === 'US' && marketCookie !== 'global') {
      const response = NextResponse.next()
      response.cookies.set(MARKET_COOKIE, 'global', {
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
        sameSite: 'lax',
      })
      return response
    }
  }

  const isProtected = PROTECTED.some((p) => pathname.startsWith(p))
  if (!isProtected) return NextResponse.next()

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // US-277: stamp a trusted `x-pathname` header (the client cannot forge it — it
  // is set server-side here) so the admin server layout can FAIL CLOSED on its
  // 2FA gate while still skipping the redirect when already on `/admin/2fa`.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

export const config = {
  matcher: ['/', '/portal/:path*', '/admin/:path*'],
}
