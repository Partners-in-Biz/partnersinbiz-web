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
})
