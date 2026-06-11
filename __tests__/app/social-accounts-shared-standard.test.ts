import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()

function readRoute(relativePath: string) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8')
}

describe('social accounts shared manager standard', () => {
  const routes = [
    'app/(portal)/portal/social/accounts/page.tsx',
  ]

  it.each(routes)('%s uses the shared social accounts manager', (route) => {
    const source = readRoute(route)

    expect(source).toContain("@/components/social/SocialAccountsManager")
  })

})
