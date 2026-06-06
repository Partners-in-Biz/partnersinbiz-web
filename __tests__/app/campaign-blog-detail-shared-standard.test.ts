import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('campaign blog detail shared standard', () => {
  const routes = [
    'app/(admin)/admin/org/[slug]/social/[id]/blog/[blogId]/page.tsx',
    'app/(portal)/portal/campaigns/[id]/blog/[blogId]/page.tsx',
  ]

  it('keeps admin and portal blog detail routes on the shared review workspace', () => {
    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/campaign-blog-detail/CampaignBlogDetailWorkspace')
      expect(file).not.toContain("from '@/components/campaign-preview'")
      expect(file).not.toContain("from '@/components/inline-comments'")
      expect(file).not.toContain('<SelectionPopover')
      expect(file).not.toContain('<CommentComposer')
      expect(file).not.toContain('<CommentList')
      expect(file).not.toContain('<BlogReaderCard')
    }
  })

  it('keeps blog detail route controllers in the shared campaign-blog-detail hook', () => {
    expect(source('components/campaign-blog-detail/useCampaignBlogDetail.ts')).toContain(
      'export function useCampaignBlogDetail',
    )

    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/campaign-blog-detail/useCampaignBlogDetail')
      expect(file).not.toContain('function commentPayload')
      expect(file).not.toContain('useState<CampaignBlogDetailRecord')
      expect(file).not.toContain('useState<CampaignBlogDetailComment')
      expect(file).not.toContain('fetch(`/api/v1/campaigns/${id}/assets`')
      expect(file).not.toContain('fetch(campaignAssetsEndpoint)')
    }
  })
})
