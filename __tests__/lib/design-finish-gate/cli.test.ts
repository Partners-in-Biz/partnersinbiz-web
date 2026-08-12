import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { renderVerdictMarkdown, renderVerdictLine } from '../../../lib/design-finish-gate/report'
import type { FinishGateReport } from '../../../lib/design-finish-gate/types'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
const CLI = path.join(REPO_ROOT, 'scripts', 'design-finish-gate.ts')

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-gate-cli-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

const BRIEF = [
  '# Landing redesign',
  '- Add a hero section with the brand palette',
  '- Ensure WCAG AA contrast on body text',
  '- Ship the mobile nav drawer',
].join('\n')

function shipReview(): string {
  return JSON.stringify({
    verdict: 'ship',
    promiseScores: {
      p1: { score: 'resolved', note: 'hero matches' },
      p2: { score: 'resolved', note: 'AA ok' },
      p3: { score: 'resolved', note: 'drawer works' },
    },
    strengths: ['solid'],
    concerns: [],
    fixRequests: [],
    reviewerAgentId: 'qa-release',
    evidence: 'inspected hero.png + mobile.png (screenshots in contract)',
  })
}

describe('design-finish-gate CLI', () => {
  it('prints help and exits 0', () => {
    const { stdout, status } = runCli(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Exit codes: 0 ship / 2 fix / 3 rebuild')
  })

  it('prepare emits a fresh-reviewer prompt and contract JSON', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout, status } = runCli(['prepare', '--brief-file', briefFile, '--title', 'Landing redesign', '--builder-agent', 'theo'])
    expect(status).toBe(0)
    expect(stdout).toContain('FRESH REVIEWER PROMPT')
    expect(stdout).toContain('pib-design-finish-gate-reviewer/v1')
    expect(stdout).toContain('p1')
    expect(stdout).toContain('"builderAgentId": "theo"')
  })

  it('prepare --json emits an envelope with contract', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout, status } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--json'])
    expect(status).toBe(0)
    const envelope = JSON.parse(stdout)
    expect(envelope.schema).toBe('pib-design-finish-gate-prepare/v1')
    expect(envelope.contract.schema).toBe('pib-design-finish-gate/v1')
    expect(envelope.contract.promises).toHaveLength(3)
  })

  it('verify returns exit 0 for a ship verdict', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout: prepareOut } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--json'])
    const contract = (JSON.parse(prepareOut) as { contract: unknown }).contract
    const contractFile = tmpFile('contract.json', JSON.stringify(contract))
    const reviewerFile = tmpFile('reviewer.json', shipReview())
    const { stdout, status } = runCli(['verify', '--contract', contractFile, '--reviewer-output', reviewerFile, '--json'])
    expect(status).toBe(0)
    const report = JSON.parse(stdout) as FinishGateReport
    expect(report.verdict).toBe('ship')
    expect(report.exitCode).toBe(0)
    expect(report.summary).toEqual({ resolved: 3, partial: 0, unresolved: 0, total: 3 })
  })

  it('verify exits 2 for fix with rounds remaining', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout: prepareOut } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--json'])
    const contractFile = tmpFile('contract.json', JSON.stringify((JSON.parse(prepareOut) as { contract: unknown }).contract))
    const fixReview = JSON.parse(shipReview()) as { promiseScores: Record<string, { score: string }> }
    fixReview.verdict = 'fix'
    fixReview.promiseScores.p2 = { score: 'partial', note: 'close but not AA' }
    const reviewerFile = tmpFile('reviewer.json', JSON.stringify(fixReview))
    const { stdout, status } = runCli(['verify', '--contract', contractFile, '--reviewer-output', reviewerFile, '--json'])
    expect(status).toBe(2)
    const report = JSON.parse(stdout) as FinishGateReport
    expect(report.verdict).toBe('fix')
    expect(report.roundsRemaining).toBe(1)
  })

  it('verify exits 3 for rebuild / unresolved', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout: prepareOut } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--json'])
    const contractFile = tmpFile('contract.json', JSON.stringify((JSON.parse(prepareOut) as { contract: unknown }).contract))
    const rebuildReview = JSON.parse(shipReview()) as { promiseScores: Record<string, { score: string }> }
    rebuildReview.verdict = 'rebuild'
    rebuildReview.promiseScores.p1 = { score: 'unresolved', note: 'no hero at all' }
    const reviewerFile = tmpFile('reviewer.json', JSON.stringify(rebuildReview))
    const { stdout, status } = runCli(['verify', '--contract', contractFile, '--reviewer-output', reviewerFile, '--json'])
    expect(status).toBe(3)
    const report = JSON.parse(stdout) as FinishGateReport
    expect(report.verdict).toBe('rebuild')
  })

  it('verify exits 1 and rejects self-grading', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout: prepareOut } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--json'])
    const contractFile = tmpFile('contract.json', JSON.stringify((JSON.parse(prepareOut) as { contract: unknown }).contract))
    const selfReview = JSON.parse(shipReview()) as { reviewerAgentId: string }
    selfReview.reviewerAgentId = 'theo' // the builder
    const reviewerFile = tmpFile('reviewer.json', JSON.stringify(selfReview))
    const { stderr, status } = runCli(['verify', '--contract', contractFile, '--reviewer-output', reviewerFile, '--json'])
    expect(status).toBe(1)
    expect(stderr).toContain('self-grade rejected')
  })

  it('verify exits 1 for a malformed reviewer output', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout: prepareOut } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--json'])
    const contractFile = tmpFile('contract.json', JSON.stringify((JSON.parse(prepareOut) as { contract: unknown }).contract))
    const reviewerFile = tmpFile('reviewer.json', JSON.stringify({ verdict: 'nope', reviewerAgentId: 'qa-release' }))
    const { status } = runCli(['verify', '--contract', contractFile, '--reviewer-output', reviewerFile])
    expect(status).toBe(1)
  })

  it('verify exits 1 when ship verdict has zero evidence (evidence fail-closed)', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const { stdout: prepareOut } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--json'])
    const contractFile = tmpFile('contract.json', JSON.stringify((JSON.parse(prepareOut) as { contract: unknown }).contract))
    const bareReview = JSON.parse(shipReview()) as { evidence: string }
    delete bareReview.evidence // no screenshots, no transcripts, no citation
    const reviewerFile = tmpFile('reviewer.json', JSON.stringify(bareReview))
    const { status } = runCli(['verify', '--contract', contractFile, '--reviewer-output', reviewerFile, '--json'])
    expect(status).toBe(1)
  })

  it('prepare --vision fails closed and still prepares when modlens is unavailable', () => {
    const briefFile = tmpFile('brief.md', BRIEF)
    const pngDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-gate-cli-vision-'))
    const png = path.join(pngDir, 'a.png')
    fs.writeFileSync(png, 'x')
    const { stdout, status } = runCli(['prepare', '--brief-file', briefFile, '--builder-agent', 'theo', '--screenshots', png, '--vision', '--json'])
    expect(status).toBe(0)
    const envelope = JSON.parse(stdout) as { contract: { screenshots: string[]; visionTranscripts?: Record<string, string> }; visionNotes: string[] }
    expect(envelope.contract.screenshots).toContain(png)
    // Real modlens may or may not be installed; either way the prepare succeeds.
    expect(envelope.visionNotes).toBeDefined()
  })

  it('renders markdown report with verdict and table', () => {
    const report: FinishGateReport = {
      schema: 'pib-design-finish-gate/v1',
      verdict: 'fix',
      exitCode: 2,
      round: 1,
      maxFixRounds: 2,
      roundsRemaining: 1,
      promises: [{ id: 'p1', label: 'Add hero', score: 'resolved' }, { id: 'p2', label: 'AA contrast', score: 'partial', note: 'close' }],
      summary: { resolved: 1, partial: 1, unresolved: 0, total: 2 },
      strengths: ['nice palette'],
      concerns: ['contrast'],
      fixRequests: ['darken body text'],
      reviewerAgentId: 'qa-release',
      selfGradedRejected: false,
      at: '2026-08-09T00:00:00.000Z',
    }
    const md = renderVerdictMarkdown(report)
    expect(md).toContain('🔧 FIX')
    expect(md).toContain('| p1 Add hero | resolved |')
    expect(md).toContain('darken body text')
    expect(renderVerdictLine(report)).toContain('finish-gate: fix (exit 2)')
  })
})
