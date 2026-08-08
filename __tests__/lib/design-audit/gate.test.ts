import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  runGate,
  resolveGateFiles,
  blockingFindings,
  formatGateHuman,
  UI_EXTENSIONS,
  type GateOptions,
} from '../../../scripts/design-audit-gate'
import { runAudit } from '../../../lib/design-audit'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'design-audit-gate-'))
}

function write(files: Record<string, string>): string {
  const dir = tmpDir()
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

const baseOpts = (over: Partial<GateOptions> = {}): GateOptions => ({
  mode: 'light',
  json: false,
  noDesignSystem: false,
  ignoreRules: [],
  ignoreValues: [],
  ignoreFiles: [],
  noInlineIgnores: false,
  noConfig: true,
  ...over,
})

describe('design-audit gate', () => {
  it('filters to UI extensions only', () => {
    expect(UI_EXTENSIONS.has('.tsx')).toBe(true)
    expect(UI_EXTENSIONS.has('.ts')).toBe(false)
    expect(UI_EXTENSIONS.has('.jsx')).toBe(true)
    expect(UI_EXTENSIONS.has('.css')).toBe(true)
    expect(UI_EXTENSIONS.has('.html')).toBe(true)
  })

  it('resolves explicit files and keeps only existing UI files', () => {
    const dir = write({
      'page.tsx': '<div>ok</div>',
      'lib/logic.ts': 'export const x = 1',
      'styles.css': '.x { color: red }',
    })
    const files = resolveGateFiles(baseOpts({ files: [path.join(dir, 'page.tsx'), path.join(dir, 'lib/logic.ts'), path.join(dir, 'styles.css')] }))
    expect(files).toContain(path.join(dir, 'page.tsx'))
    expect(files).toContain(path.join(dir, 'styles.css'))
    expect(files).not.toContain(path.join(dir, 'lib/logic.ts'))
  })

  it('resolves staged files through the injected git reader', () => {
    const dir = write({ 'page.tsx': '<div>ok</div>', 'data.json': '{}' })
    const files = resolveGateFiles(baseOpts({
      staged: true,
      _gitFiles: () => [path.join(dir, 'page.tsx'), path.join(dir, 'data.json')],
    }))
    expect(files).toEqual([path.join(dir, 'page.tsx')])
  })

  it('passes on clean UI files with exit 0', () => {
    const dir = write({ 'page.tsx': '<html lang="en"><body><h1>Title</h1><p>Clean.</p></body></html>' })
    const gate = runGate(baseOpts({ files: [path.join(dir, 'page.tsx')] }))
    expect(gate.exitCode).toBe(0)
    expect(gate.blocked).toBe(false)
    expect(gate.summary.filesScanned).toBe(1)
    expect(gate.summary.blockedFindings).toBe(0)
  })

  it('blocks on P0/P1 findings with exit 2 (light mode)', () => {
    const dir = write({
      'page.tsx': '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>',
    })
    const gate = runGate(baseOpts({ files: [path.join(dir, 'page.tsx')] }))
    expect(gate.exitCode).toBe(2)
    expect(gate.blocked).toBe(true)
    expect(gate.summary.blockedFindings).toBeGreaterThan(0)
    expect(gate.files[0].blockedFindings.some((f) => f.rule === 'purple-gradients')).toBe(true)
  })

  it('does not block on P2/P3-only findings (light mode)', () => {
    // long-line-length is P2 — should not block the gate.
    const longLine = 'x'.repeat(150)
    const dir = write({
      'page.tsx': `<p>${longLine}</p>`,
    })
    const gate = runGate(baseOpts({ files: [path.join(dir, 'page.tsx')] }))
    const p2p3 = gate.files[0].result.findings.filter((f) => f.severity === 'P2' || f.severity === 'P3')
    expect(p2p3.length).toBeGreaterThan(0)
    expect(gate.exitCode).toBe(0)
  })

  it('honors inline impeccable-disable ignores', () => {
    const dir = write({
      'page.tsx': '<!-- impeccable-disable purple-gradients -->\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>',
    })
    const gate = runGate(baseOpts({ files: [path.join(dir, 'page.tsx')] }))
    expect(gate.exitCode).toBe(0)
  })

  it('honors ignoreRules', () => {
    const dir = write({
      'page.tsx': '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>',
    })
    const gate = runGate(baseOpts({ files: [path.join(dir, 'page.tsx')], ignoreRules: ['purple-gradients'] }))
    expect(gate.exitCode).toBe(0)
  })

  it('reports errors as exit 1', () => {
    const gate = runGate(baseOpts({ files: ['/definitely/missing/file.tsx'] }))
    expect(gate.exitCode).toBe(1)
  })

  it('always emits a verdict even with no files scanned', () => {
    const gate = runGate(baseOpts({ files: [] }))
    expect(gate.exitCode).toBe(0)
    expect(gate.summary.filesScanned).toBe(0)
    expect(formatGateHuman(gate)).toContain('no UI files scanned')
  })

  it('deep mode reports P2/P3 as advisory but still passes on them', () => {
    const longLine = 'x'.repeat(150)
    const dir = write({
      'page.tsx': `<p>${longLine}</p>`,
    })
    const gate = runGate(baseOpts({ mode: 'deep', files: [path.join(dir, 'page.tsx')] }))
    expect(gate.exitCode).toBe(0)
    const human = formatGateHuman(gate)
    expect(human).toContain('advisory')
  })

  it('mergeResults drives blocked count across multiple files', () => {
    const dir = write({
      'a.tsx': '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>',
      'b.tsx': '<html lang="en"><body><h1>Ok</h1></body></html>',
    })
    const gate = runGate(baseOpts({ files: [path.join(dir, 'a.tsx'), path.join(dir, 'b.tsx')] }))
    expect(gate.exitCode).toBe(2)
    expect(gate.summary.filesBlocked).toBe(1)
    expect(gate.summary.filesScanned).toBe(2)
  })
})

describe('blockingFindings severity filter', () => {
  it('keeps only P0/P1', () => {
    const result = runAudit('<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"><p>Copy — with dashes — ok.</p></div>', { fileName: 'x.tsx' })
    const blocked = blockingFindings(result.findings)
    expect(blocked.length).toBeGreaterThan(0)
    for (const f of blocked) {
      expect(['P0', 'P1']).toContain(f.severity)
    }
  })
})
