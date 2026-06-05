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
})
