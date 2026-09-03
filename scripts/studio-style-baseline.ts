/**
 * Studio style lint (absolute). Scans app and components (excluding
 * components/marketing and non-UI paths) for banned patterns from the
 * migration plan section 1.4. Any hit fails the gate.
 *
 * Usage: npm run studio:style-lint
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

/** Banned list from plan section 1.4 (regex sources). */
export const BANNED_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'pib-mesh', re: /\bpib-mesh\b/g },
  { id: 'pib-grid-bg', re: /\bpib-grid-bg\b/g },
  { id: 'pib-glass', re: /\bpib-glass[\w-]*/g },
  { id: 'pib-aurora', re: /\bpib-aurora[\w-]*/g },
  { id: 'pib-neural-field', re: /\bpib-neural-field\b/g },
  { id: 'pib-scanlines', re: /\bpib-scanlines\b/g },
  { id: 'pib-shell-glow', re: /\bpib-shell-glow\b/g },
  { id: 'pib-hud-chip', re: /\bpib-hud-chip\b/g },
  { id: 'pib-signal-meter', re: /\bpib-signal-meter\b/g },
  { id: 'pib-glass-bar', re: /\bpib-glass-bar\b/g },
  { id: 'pib-live-surface', re: /\bpib-live-surface\b/g },
  { id: 'pib-avatar-ring', re: /\bpib-avatar-ring\b/g },
  { id: 'pib-icon-tint', re: /\bpib-icon-tint[\w-]*/g },
  { id: 'bg-gradient', re: /\bbg-gradient-\w+/g },
  { id: 'from-', re: /\bfrom-(?:\[|#|[\w/-])/g },
  { id: 'via-', re: /\bvia-(?:\[|#|[\w/-])/g },
  { id: 'to-', re: /\bto-(?:\[|#|[\w/-])/g },
  { id: 'backdrop-blur', re: /\bbackdrop-blur[\w-]*/g },
  { id: 'font-display', re: /\bfont-display\b/g },
  { id: 'font-serif', re: /\bfont-serif\b/g },
  { id: 'rounded-2xl', re: /\brounded-2xl\b/g },
  { id: 'rounded-3xl', re: /\brounded-3xl\b/g },
  { id: 'rounded-xl', re: /\brounded-xl\b/g },
  { id: 'rounded-full', re: /\brounded-full\b/g },
  { id: 'shadow-lg', re: /\bshadow-lg\b/g },
  { id: 'shadow-xl', re: /\bshadow-xl\b/g },
  { id: 'shadow-2xl', re: /\bshadow-2xl\b/g },
  { id: 'text-amber', re: /\btext-amber-\d+\b/g },
  { id: 'text-violet', re: /\btext-violet-\d+\b/g },
  { id: 'bg-amber', re: /\bbg-amber-\d+\b/g },
  { id: 'bg-violet', re: /\bbg-violet-\d+\b/g },
  { id: 'hex-F5A623', re: /#F5A623\b/gi },
  { id: 'hex-7C5CFF', re: /#7C5CFF\b/gi },
  { id: 'hex-0A0A0B', re: /#0A0A0B\b/gi },
  { id: 'text-red-400', re: /\btext-red-400\b/g },
  { id: 'font-semibold', re: /\bfont-semibold\b/g },
  { id: 'font-bold', re: /\bfont-bold\b/g },
  { id: 'em-dash', re: /\u2014/g },
  { id: 'material-symbols', re: /material-symbols(?:-outlined)?/g },
]

const EXT = new Set(['.ts', '.tsx', '.css', '.js', '.jsx', '.mjs', '.cjs'])

function shouldSkip(rel: string): boolean {
  if (rel.startsWith('components/marketing/')) return true
  if (rel.startsWith('app/api/')) return true
  if (rel.includes('/node_modules/')) return true
  if (rel.includes('/.next/')) return true
  if (rel === 'app/globals.css') return true
  if (rel === 'components/studio/studio-ui.css') return true
  if (rel === 'app/studio-tokens.css') return true
  if (rel === 'components/studio/index.tsx') return true
  return false
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (EXT.has(path.extname(name))) {
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (!shouldSkip(rel)) acc.push(rel)
    }
  }
  return acc
}

export function countBannedInSource(src: string): number {
  let total = 0
  for (const { re } of BANNED_PATTERNS) {
    re.lastIndex = 0
    const m = src.match(re)
    if (m) total += m.length
  }
  return total
}

export function scanStyleDebt(): Record<string, number> {
  const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))].sort()
  const map: Record<string, number> = {}
  for (const file of files) {
    const src = readFileSync(path.join(root, file), 'utf8')
    const n = countBannedInSource(src)
    if (n > 0) map[file] = n
  }
  return map
}

function main() {
  const debt = scanStyleDebt()
  const files = Object.keys(debt)
  if (files.length === 0) {
    console.log('studio:style-lint OK — zero banned-pattern hits')
    return
  }
  console.error('studio:style-lint FAILED — banned patterns remain:')
  for (const f of files.sort()) console.error(`  ${debt[f]}\t${f}`)
  process.exit(1)
}

const isDirect =
  (typeof require !== 'undefined' && require.main === module) ||
  (typeof process !== 'undefined' && process.argv[1] && process.argv[1].includes('studio-style-baseline'))

if (isDirect) {
  main()
}
