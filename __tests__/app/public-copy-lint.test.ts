import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CTA_LABEL } from '@/lib/seo/site'

/**
 * Taste floor for public marketing copy. Source files that carry customer-facing
 * words on the public tree must not use em dashes, and every call to action must
 * use the one CTA label from lib/seo/site.ts.
 *
 * Forms, widgets and data-display pages are UI, not copy, and are excluded.
 */

const ROOT = join(__dirname, '..', '..')

const COPY_ROOTS = [
  'app/(public)',
  'components/marketing',
  'components/layout',
  'lib/marketing',
  'app/llms.txt',
]

const COPY_FILES = ['lib/seo/site.ts', 'lib/seo/market-offers.ts']

const EXCLUDE = [
  /Form\.tsx$/,
  /Widget\.tsx$/,
  /\/seo-audit\//,
  /\/start-a-project\//,
  /\/book-a-call\//,
  /\/gauteng-growth-audit\//,
  /\/tools\//,
  /\/insights\//,
  /\/partner-with-us\//,
  /\/start\//,
  /\/offline\//,
  /\/privacy-policy\//,
  /\/terms-of-service\//,
  /\/verify\//,
  /\/invoice\//,
  /\/edit\//,
]

const STRAY_CTAS = ['Start a project', 'Book a call', 'Book 20 minutes', 'Book a 20-min intro', 'Book a discovery call']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const files = [
  ...COPY_ROOTS.flatMap((dir) => walk(join(ROOT, dir))),
  ...COPY_FILES.map((f) => join(ROOT, f)),
]
  .map((f) => relative(ROOT, f))
  .filter((f) => !EXCLUDE.some((re) => re.test(`/${f}`)))

describe('public copy lint', () => {
  it('covers the public tree', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'app/(public)/page.tsx',
        'app/(public)/pricing/page.tsx',
        'app/(public)/services/page.tsx',
        'lib/marketing/stage-content.ts',
        'lib/seo/site.ts',
      ])
    )
  })

  it('has no em dashes in public copy sources', () => {
    const offenders = files
      .map((f) => ({ f, lines: readFileSync(join(ROOT, f), 'utf8').split('\n') }))
      .flatMap(({ f, lines }) =>
        lines.flatMap((line, i) => (line.includes('\u2014') ? [`${f}:${i + 1}: ${line.trim().slice(0, 100)}`] : []))
      )
    expect(offenders).toEqual([])
  })

  it('uses the single CTA label everywhere', () => {
    expect(CTA_LABEL).toBe('Book a 20-min call')
    const offenders = files
      .map((f) => ({ f, lines: readFileSync(join(ROOT, f), 'utf8').split('\n') }))
      .flatMap(({ f, lines }) =>
        lines.flatMap((line, i) => {
          const hit = STRAY_CTAS.find((label) => new RegExp(`(^|[>'"\`\\s])${label}([<'"\`.\\s]|$)`).test(line))
          return hit ? [`${f}:${i + 1}: ${line.trim().slice(0, 100)}`] : []
        })
      )
    expect(offenders).toEqual([])
  })
})
