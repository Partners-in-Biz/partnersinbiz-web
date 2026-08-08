import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
const CLI = path.join(REPO_ROOT, 'scripts', 'design-audit.ts')

function runCli(args: string[], input?: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', status: e.status ?? 1 }
  }
}

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-audit-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

describe('design-audit CLI', () => {
  it('prints help and exits 0', () => {
    const { stdout, status } = runCli(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Exit codes: 0 clean / 2 findings / 1 failure')
  })

  it('exits 0 on a clean file', () => {
    const file = tmpFile('clean.html', '<html lang="en"><body><h1>Title</h1><p>Clean copy.</p></body></html>')
    const { status, stdout } = runCli([file])
    expect(status).toBe(0)
    expect(stdout).toContain('0 finding(s)')
  })

  it('exits 2 with findings and prints grouped output', () => {
    const file = tmpFile('dirty.html', '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>')
    const { status, stdout } = runCli([file])
    expect(status).toBe(2)
    expect(stdout).toContain('purple-gradients')
    expect(stdout).toContain('finding(s)')
  })

  it('exits 1 on a missing target', () => {
    const { status, stderr } = runCli(['/nonexistent/nope.html'])
    expect(status).toBe(1)
    expect(stderr.length).toBeGreaterThan(0)
  })

  it('emits JSON with the pib-design-audit/v1 schema', () => {
    const file = tmpFile('dirty.html', '<img alt="x">')
    const { stdout, status } = runCli(['--json', file])
    expect(status).toBe(2)
    const payload = JSON.parse(stdout)
    expect(payload.schema).toBe('pib-design-audit/v1')
    expect(payload.exitCode).toBe(2)
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0].findings.some((f: { rule: string }) => f.rule === 'broken-images')).toBe(true)
  })

  it('narrows with --scope type', () => {
    const file = tmpFile('mixed.html', '<p style="font-size: 10px">tiny</p><div style="box-shadow: 0 0 40px rgba(0,0,0,0.3)">glow</div>')
    const { stdout } = runCli(['--json', '--scope', 'type', file])
    const payload = JSON.parse(stdout)
    const rules = new Set(payload.files[0].findings.map((f: { rule: string }) => f.rule))
    expect(rules.has('tiny-body-text')).toBe(true)
    expect(rules.has('dark-glow')).toBe(false)
  })

  it('enables drift rules with --design-context', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-audit-drift-'))
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), '## Colors\n- #0F172A\n## Typography\n- Inter\n## Radii\n- 8px\n## Font Sizes\n- 16px\n')
    const file = path.join(dir, 'page.html')
    fs.writeFileSync(file, `<p style="font-family: 'Comic Sans MS'; color: #ff0000; border-radius: 14px">drift</p>`)
    const { stdout, status } = runCli(['--json', '--design-context', path.join(dir, 'DESIGN.md'), file])
    expect(status).toBe(2)
    const payload = JSON.parse(stdout)
    const rules = payload.files[0].findings.map((f: { rule: string }) => f.rule)
    expect(rules).toContain('font-outside-design')
    expect(rules).toContain('color-outside-design')
    expect(rules).toContain('radius-outside-design')
  })

  it('supports --ignore-rule', () => {
    const file = tmpFile('dirty.html', '<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>')
    const { stdout, status } = runCli(['--json', '--ignore-rule', 'purple-gradients', file])
    expect(status).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.summary.total).toBe(0)
  })

  it('reads from stdin', () => {
    const { stdout, status } = runCli(['--json'], '<img alt="x">')
    expect(status).toBe(2)
    const payload = JSON.parse(stdout)
    expect(payload.files[0].file).toBe('<stdin>')
  })

  it('scans a directory for design files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-audit-dir-'))
    fs.writeFileSync(path.join(dir, 'a.html'), '<img alt="x">')
    fs.writeFileSync(path.join(dir, 'b.css'), '.x { background: linear-gradient(90deg, #7c3aed, #2563eb); }')
    const { stdout } = runCli(['--json', dir])
    const payload = JSON.parse(stdout)
    expect(payload.files).toHaveLength(2)
    const allRules = payload.files.flatMap((f: { findings: Array<{ rule: string }> }) => f.findings.map((x) => x.rule))
    expect(allRules).toContain('broken-images')
    expect(allRules).toContain('purple-gradients')
  })
})
