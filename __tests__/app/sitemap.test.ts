import sitemap from '@/app/sitemap'
import { SITE } from '@/lib/seo/site'

describe('public sitemap', () => {
  it('includes the Gauteng growth audit campaign page', async () => {
    await expect(sitemap()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: `${SITE.url}/gauteng-growth-audit` }),
      ])
    )
  })

  it('includes public conversion pages and excludes redirected URLs', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)

    expect(urls).toEqual(
      expect.arrayContaining([
        `${SITE.url}/book-a-call`,
        `${SITE.url}/faq`,
        `${SITE.url}/properties`,
        `${SITE.url}/partner-with-us`,
        `${SITE.url}/partner-with-us/ballito-regional-coupon-partner`,
        `${SITE.url}/partner-with-us/athleet-club-growth`,
        `${SITE.url}/partner-with-us/local-growth-scout`,
      ])
    )
    expect(urls).not.toContain(`${SITE.url}/products`)
  })

  it('includes published Firestore-backed campaign insights', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)

    expect(urls).toEqual(
      expect.arrayContaining([
        `${SITE.url}/insights/ai-agent-ecosystem`,
        `${SITE.url}/insights/end-tool-fragmentation`,
        `${SITE.url}/insights/client-story-r250k-revenue-in-month-1`,
        `${SITE.url}/insights/multi-client-management`,
      ])
    )
  })
})
