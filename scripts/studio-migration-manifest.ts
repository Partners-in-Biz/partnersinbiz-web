/**
 * Studio migration page manifest.
 * Walks app page.tsx, layout.tsx, not-found.tsx and global-error.tsx files
 * and writes docs/studio-migration/pages.json, preserving existing entries.
 *
 * Usage: npx tsx scripts/studio-migration-manifest.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const appDir = path.join(root, 'app')
const outDir = path.join(root, 'docs/studio-migration')
const outFile = path.join(outDir, 'pages.json')

const TARGETS = new Set(['page.tsx', 'layout.tsx', 'not-found.tsx', 'global-error.tsx'])

/** Pure redirects and OG — status `na`. */
const NA_PATHS = new Set([
  'app/(public)/contact/page.tsx',
  'app/(portal)/portal/page.tsx',
  'app/(admin)/admin/page.tsx',
  'app/(portal)/portal/analytics/page.tsx',
  'app/(portal)/portal/project/page.tsx',
])

type Entry = { status: 'todo' | 'done' | 'na'; batch: string; note: string }

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (TARGETS.has(name)) acc.push(path.relative(root, full).split(path.sep).join('/'))
  }
  return acc
}

function inferBatch(file: string): string {
  if (file.includes('/(public)/') || file.startsWith('app/(public)')) return 'public'
  if (file.includes('/(auth)/') || file.includes('/login') || file.includes('/register')) return '4.1'
  if (file.includes('not-found') || file.includes('global-error') || file.includes('admin-access-denied') || file.includes('/offline') || file.includes('/status'))
    return '4.2'
  if (
    file.includes('/invoice/') ||
    file.includes('/reports/') ||
    file.includes('/preferences/') ||
    file.includes('/lead/') ||
    file.includes('/partners/invite') ||
    file.includes('/d/') ||
    file.includes('/c/') ||
    file.includes('/embed/')
  )
    return '4.3'
  if (file.includes('/(portal)/')) {
    if (file.includes('/settings/')) return '4.5'
    if (
      file.includes('/crm') ||
      file.includes('/companies') ||
      file.includes('/contacts') ||
      file.includes('/deals') ||
      file.includes('/enquiries') ||
      file.includes('/segments') ||
      file.includes('/tags') ||
      file.includes('/quotes') ||
      file.includes('/sequences') ||
      file.includes('/suppression') ||
      file.includes('/capture-sources') ||
      file.includes('/conversations') ||
      file.includes('/messages') ||
      file.includes('/communications')
    )
      return '4.6'
    if (file.includes('/finance') || file.includes('/invoicing') || file.includes('/documents')) return '4.7'
    if (
      file.includes('/campaigns') ||
      file.includes('/email') ||
      file.includes('/broadcasts') ||
      file.includes('/social') ||
      file.includes('/personal') ||
      file.includes('/branding') ||
      file.includes('/creative-canvas') ||
      file.includes('/video-editor') ||
      file.includes('/youtube-studio') ||
      file.includes('/book-studio') ||
      file.includes('/briefings') ||
      file.includes('/research') ||
      file.includes('/marketing') ||
      file.includes('/content-campaigns')
    )
      return '4.8'
    if (file.includes('/seo') || file.includes('/geo-seo') || file.includes('/analytics') || file.includes('/ads') || file.includes('/reports'))
      return '4.9'
    if (
      file.includes('/dashboard') ||
      file.includes('/first-run') ||
      file.includes('/changelog') ||
      file.includes('/wiki') ||
      file.includes('/data') ||
      file.includes('/referrals') ||
      file.includes('/integrations') ||
      file.includes('/billing') ||
      file.includes('/payments')
    )
      return '4.4'
    if (file.includes('/partners') || file.includes('/projects') || file.includes('/properties') || file.includes('/life-os') || file.includes('/mobile-apps'))
      return '4.10'
    return '4.10'
  }
  if (file.includes('/(admin)/') || file.includes('/admin/')) {
    if (file.includes('/admin/org/') || file.includes('/orgs/') || file.includes('/[slug]/')) return '4.12'
    if (
      file.includes('/hermes') ||
      file.includes('/legal') ||
      file.includes('/moderation') ||
      file.includes('/mission-control') ||
      file.includes('/skill-lab') ||
      file.includes('/support') ||
      file.includes('/partners') ||
      file.includes('/properties') ||
      file.includes('/creative-canvas')
    )
      return '4.13'
    return '4.11'
  }
  return ''
}

function isNa(file: string): boolean {
  if (file.includes('/og/')) return true
  if (NA_PATHS.has(file)) return true
  return false
}

function isPublicDone(file: string): boolean {
  return file.includes('/(public)/') || file.startsWith('app/(public)/')
}

export function buildManifest(existing: Record<string, Entry> = {}): Record<string, Entry> {
  const files = walk(appDir).sort()
  const next: Record<string, Entry> = {}

  for (const file of files) {
    const prev = existing[file]
    if (prev) {
      next[file] = { status: prev.status, batch: prev.batch || inferBatch(file), note: prev.note || '' }
      continue
    }
    if (isNa(file)) {
      next[file] = { status: 'na', batch: inferBatch(file), note: 'redirect or og' }
    } else if (isPublicDone(file)) {
      next[file] = { status: 'done', batch: 'public', note: 'public Studio' }
    } else {
      next[file] = { status: 'todo', batch: inferBatch(file), note: '' }
    }
  }
  return next
}

export function listAppTargets(): string[] {
  return walk(appDir).sort()
}

function main() {
  mkdirSync(outDir, { recursive: true })
  let existing: Record<string, Entry> = {}
  if (existsSync(outFile)) {
    existing = JSON.parse(readFileSync(outFile, 'utf8')) as Record<string, Entry>
  }
  const manifest = buildManifest(existing)
  writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n')
  const counts = { todo: 0, done: 0, na: 0 }
  for (const e of Object.values(manifest)) counts[e.status]++
  console.log(`Wrote ${outFile} (${Object.keys(manifest).length} entries: ${counts.done} done, ${counts.todo} todo, ${counts.na} na)`)
}

const isDirect = typeof require !== 'undefined' && require.main === module
  || (typeof process !== 'undefined' && process.argv[1] && process.argv[1].includes('studio-migration-manifest'))

if (isDirect) {
  main()
}
