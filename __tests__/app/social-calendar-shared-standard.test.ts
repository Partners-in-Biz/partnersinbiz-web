import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()

function readRoute(relativePath: string) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8')
}

describe('social calendar shared workspace standard', () => {
  const routes = [
    'app/(portal)/portal/social/calendar/page.tsx',
  ]

  it.each(routes)('%s uses the shared calendar workspace instead of a forked UI', (route) => {
    const source = readRoute(route)

    expect(source).toContain("@/components/social/SocialCalendarWorkspace")
    expect(source).not.toMatch(/const PLATFORM_ICONS/)
    expect(source).not.toMatch(/const STATUS_(COLORS|STYLES)/)
    expect(source).not.toMatch(/const MONTH_NAMES/)
    expect(source).not.toMatch(/const DAY_HEADERS/)
    expect(source).not.toMatch(/function PlatformIcon/)
    expect(source).not.toMatch(/function PostChip/)
    expect(source).not.toMatch(/function getCalendarDays/)
    expect(source).not.toMatch(/function getWeekDays/)
  })
})
