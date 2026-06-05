import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()

function readRoute(relativePath: string) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8')
}

describe('social accounts shared manager standard', () => {
  const routes = [
    'app/(admin)/admin/social/accounts/page.tsx',
    'app/(portal)/portal/social/accounts/page.tsx',
  ]

  it.each(routes)('%s uses the shared social accounts manager', (route) => {
    const source = readRoute(route)

    expect(source).toContain("@/components/social/SocialAccountsManager")
  })

  it('keeps the admin accounts route as a thin adapter', () => {
    const source = readRoute('app/(admin)/admin/social/accounts/page.tsx')

    expect(source).not.toMatch(/const PLATFORM_ICONS/)
    expect(source).not.toMatch(/const PLATFORM_LABELS/)
    expect(source).not.toMatch(/function PlatformBadge/)
    expect(source).not.toMatch(/function SubAccountRow/)
    expect(source).not.toMatch(/function PlatformCard/)
    expect(source).not.toMatch(/function PickerModal/)
    expect(source).not.toMatch(/function BlueskyForm/)
  })
})
