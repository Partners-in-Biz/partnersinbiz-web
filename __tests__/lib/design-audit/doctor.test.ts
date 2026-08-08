import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
const DOCTOR = path.join(REPO_ROOT, 'scripts', 'design-audit-doctor.ts')

function runDoctor(): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(TSX, [DOCTOR], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { stdout, status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: e.stdout ?? '', status: e.status ?? 1 }
  }
}

describe('design audit doctor', () => {
  it('always prints a verdict and exits 0 when all checks pass', () => {
    const { stdout, status } = runDoctor()
    // The doctor must never be silent: an explicit PASS/FAIL line is required.
    expect(stdout).toContain('Design Audit Doctor:')
    expect(stdout).toMatch(/Design Audit Doctor: (PASS|FAIL)/)
    // Every check emits a status line.
    const checkLines = stdout.split('\n').filter((l) => /^\s+\[(PASS|FAIL)\]/.test(l))
    expect(checkLines.length).toBeGreaterThanOrEqual(9)
    expect(status).toBe(0)
  })

  it('verifies engine, hook, CI, and Studio wiring are all present', () => {
    const { stdout } = runDoctor()
    expect(stdout).toContain('[PASS] engine-clean-exit-0')
    expect(stdout).toContain('[PASS] engine-slop-exit-2')
    expect(stdout).toContain('[PASS] hook-installed')
    expect(stdout).toContain('[PASS] ci-deep-gate')
    expect(stdout).toContain('[PASS] studio-gate-wired')
    expect(stdout).toContain('PASS — hook installed, engine working, CI + Studio wired')
  })
})
