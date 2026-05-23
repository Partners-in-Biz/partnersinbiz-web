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

  const response = NextResponse.next()
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

export const config = {
  matcher: ['/portal/:path*', '/admin/:path*'],
}
