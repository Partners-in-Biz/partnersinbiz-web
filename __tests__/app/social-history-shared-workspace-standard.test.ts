import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('social history shared workspace standard', () => {
  const routes = [
    'app/(portal)/portal/social/history/page.tsx',
  ]

  it('keeps admin and portal social history on one shared workspace', () => {
    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/social/SocialHistoryWorkspace')
      expect(file).not.toContain('interface SocialPost')
      expect(file).not.toContain('interface HistoryPost')
      expect(file).not.toContain('const PLATFORM_COLORS')
      expect(file).not.toContain('const STATUS_STYLES')
      expect(file).not.toContain('function PlatformBadge')
      expect(file).not.toContain('function StatusBadge')
      expect(file).not.toContain('function ExternalIdLink')
      expect(file).not.toContain('function getPostText')
      expect(file).not.toContain('function getPostPlatforms')
      expect(file).not.toContain('function tsToDate')
      expect(file).not.toContain('function fmtDateTime')
    }
  })
})
