process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csec'
process.env.GSC_REDIRECT_URI = 'https://x/api/integrations/gsc/callback'

import { gscAuthUrl } from '@/lib/seo/integrations/gsc/auth'

describe('gsc/auth', () => {
  afterEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csec'
    process.env.GSC_REDIRECT_URI = 'https://x/api/integrations/gsc/callback'
  })

  it('builds auth URL with webmasters.readonly scope', () => {
    const url = gscAuthUrl('state-123')
    expect(url).toContain('client_id=cid')
    expect(url).toContain('redirect_uri=')
    expect(url).toContain('webmasters.readonly')
    expect(url).toContain('state=state-123')
    expect(url).toContain('access_type=offline')
    expect(url).toContain('prompt=consent')
  })

  it('trims copied env values before building the auth URL', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = ' cid\n'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = ' csec\n'
    process.env.GSC_REDIRECT_URI = ' https://x/api/integrations/gsc/callback\n'

    const url = new URL(gscAuthUrl('state-123'))

    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/api/integrations/gsc/callback')
  })
})
