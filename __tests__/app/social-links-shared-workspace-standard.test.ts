import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('social links shared workspace standard', () => {
  const routes = [
    'app/(portal)/portal/social/links/page.tsx',
  ]

  it('keeps admin and portal link shortener pages on one shared workspace', () => {
    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/social/SocialLinksWorkspace')
      expect(file).not.toContain('interface ShortenedLink')
      expect(file).not.toContain('interface LinkStats')
      expect(file).not.toContain('interface SelectedLinkData')
      expect(file).not.toContain('const buildPreviewUrl')
      expect(file).not.toContain('const handleCreateLink')
      expect(file).not.toContain('const handleDeleteLink')
      expect(file).not.toContain('window.confirm')
      expect(file).not.toContain('confirm(')
    }
  })
})
