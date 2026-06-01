import sitemap from '@/app/sitemap'
import { SITE } from '@/lib/seo/site'

describe('public sitemap', () => {
  it('includes the Gauteng growth audit campaign page', () => {
    expect(sitemap()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: `${SITE.url}/gauteng-growth-audit` }),
      ])
    )
  })

  it('includes public conversion pages and excludes redirected URLs', () => {
    const urls = sitemap().map((entry) => entry.url)

    expect(urls).toEqual(
      expect.arrayContaining([
        `${SITE.url}/book-a-call`,
        `${SITE.url}/faq`,
        `${SITE.url}/properties`,
      ])
    )
    expect(urls).not.toContain(`${SITE.url}/products`)
  })
})
