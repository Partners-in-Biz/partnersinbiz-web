import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? '__session'

const PROTECTED = ['/portal', '/admin']

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
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
  matcher: ['/portal/:path*', '/admin/:path*'],
}
