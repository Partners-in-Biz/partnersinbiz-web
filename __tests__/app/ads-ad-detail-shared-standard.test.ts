import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function readAppFile(filePath: string) {
  return readFileSync(path.join(root, filePath), 'utf8')
}

describe('ads ad detail shared workspace standard', () => {
  it('keeps admin and portal ad creative detail surfaces in shared ads components', () => {
    const adminPage = readAppFile('app/(admin)/admin/org/[slug]/ads/ads/[id]/page.tsx')
    const portalPage = readAppFile('app/(portal)/portal/ads/ads/[id]/page.tsx')

    expect(existsSync(path.join(root, 'components/ads/AdCreativeDetailWorkspace.tsx'))).toBe(true)
    expect(existsSync(path.join(root, 'components/ads/CommentThread.tsx'))).toBe(true)

    expect(adminPage).toContain('@/components/ads/AdCreativeDetailWorkspace')
    expect(portalPage).toContain('@/components/ads/AdCreativeDetailWorkspace')

    expect(portalPage).toContain('@/components/ads/CommentThread')
    expect(portalPage).not.toContain('./CommentThread')
    expect(existsSync(path.join(root, 'app/(portal)/portal/ads/ads/[id]/CommentThread.tsx'))).toBe(false)
  })
})
