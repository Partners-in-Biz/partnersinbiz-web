import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('social compose shared composer standard', () => {
  const routes = [
    'app/(portal)/portal/social/compose/page.tsx',
    'app/(portal)/portal/personal/social/compose/page.tsx',
  ]

  it('keeps every social compose route on the shared composer', () => {
    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/social/SocialPostComposer')
      expect(file).not.toContain('const PLATFORMS')
      expect(file).not.toContain('const CHAR_LIMITS')
      expect(file).not.toContain('const THREAD_CAPABLE')
      expect(file).not.toContain('const CATEGORIES')
      expect(file).not.toContain('function fillTemplatePrompt')
      expect(file).not.toContain('const handleAiGenerate')
      expect(file).not.toContain('const handleAiHashtags')
      expect(file).not.toContain('const handleBestTime')
      expect(file).not.toContain('const handleGenerateImage')
      expect(file).not.toContain('const handleUseImage')
      expect(file).not.toContain('const buildBody')
    }
  })
})
