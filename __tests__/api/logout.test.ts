import { GET, POST } from '@/app/api/auth/logout/route'
import { NextRequest } from 'next/server'

describe('/api/auth/logout', () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl
  })

  it('redirects to the current request origin instead of a configured localhost site URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'

    const req = new NextRequest('https://partnersinbiz.online/api/auth/logout')
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://partnersinbiz.online/')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('supports portal POST logout with the same redirect and cookie clearing', async () => {
    const req = new NextRequest('https://app.partnersinbiz.online/api/auth/logout', {
      method: 'POST',
    })

    const res = await POST(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.partnersinbiz.online/')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
