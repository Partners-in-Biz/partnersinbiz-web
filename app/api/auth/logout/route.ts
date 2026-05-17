import { NextRequest, NextResponse } from 'next/server'

function clearSessionAndRedirect(request: NextRequest) {
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
