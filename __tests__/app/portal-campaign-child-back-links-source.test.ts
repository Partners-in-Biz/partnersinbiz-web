import { readFileSync } from 'fs'
import path from 'path'

const repoRoot = process.cwd()

function source(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('portal campaign child route back links', () => {
  it('keeps company scope when email campaigns link back to Campaigns', () => {
    const file = source('app/(portal)/portal/campaigns/email/[id]/page.tsx')

    expect(file).toContain('scopedPortalHref')
    expect(file).toContain("backHref={scopedPortalHref('/portal/campaigns', scope)}")
    expect(file).not.toContain('href="/portal/campaigns"')
  })

  it('keeps company scope when broadcasts link back to Campaigns', () => {
    const file = source('app/(portal)/portal/campaigns/broadcast/[id]/page.tsx')

    expect(file).toContain('scopedPortalHref')
    expect(file).toContain("href={scopedPortalHref('/portal/campaigns', scope)}")
    expect(file).not.toContain('href="/portal/campaigns"')
  })
})
