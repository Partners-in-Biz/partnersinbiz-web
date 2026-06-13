import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(process.cwd(), 'scripts/okf-validate-export.mjs')

async function writeFixture(root: string, relativePath: string, content: string) {
  const fullPath = join(root, relativePath)
  await mkdir(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
}

describe('okf-validate-export', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pib-okf-'))
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('reports OKF-compatible, alias, missing-type, and reserved files without mutating source', async () => {
    const coworkRoot = join(tempRoot, 'cowork-wiki')
    await writeFixture(coworkRoot, 'agents/partners/wiki/decision.md', `---
type: Decision
title: Approved thing
visibility: internal
orgId: pib-platform-owner
---
# Approved thing
`)
    await writeFixture(coworkRoot, 'agents/partners/wiki/project.md', `---
type: spec
title: Project plan
---
# Project plan
`)
    await writeFixture(coworkRoot, 'agents/partners/wiki/legacy.md', '# Legacy note\n')
    await writeFixture(coworkRoot, 'agents/partners/wiki/index.md', '# Index\n')

    const output = execFileSync('node', [script, '--root', coworkRoot, '--domain', 'agents/partners', '--sections', 'wiki', '--json'], {
      encoding: 'utf8',
    })
    const report = JSON.parse(output)

    expect(report.summary.totalMarkdown).toBe(4)
    expect(report.summary.reserved).toBe(1)
    expect(report.summary.conceptCandidates).toBe(3)
    expect(report.summary.withNonEmptyType).toBe(2)
    expect(report.summary.missingType).toBe(1)
    expect(report.summary.aliasType).toBe(1)
    expect(report.summary.canonicalType).toBe(1)
    expect(report.summary.platformParentOrg).toBe(1)
    expect(report.strictFailures).toContain('1 non-reserved concept file(s) are missing non-empty type')
  })

  it('treats later horizontal rules as content rather than frontmatter', async () => {
    const coworkRoot = join(tempRoot, 'cowork-wiki')
    await writeFixture(coworkRoot, 'agents/partners/wiki/horizontal.md', `# Has a rule

---
Not frontmatter.
`)

    const output = execFileSync('node', [script, '--root', coworkRoot, '--domain', 'agents/partners', '--sections', 'wiki', '--json'], {
      encoding: 'utf8',
    })
    const report = JSON.parse(output)

    expect(report.summary.withFrontmatter).toBe(0)
    expect(report.summary.missingType).toBe(1)
    expect(report.samples.missingType).toEqual(['agents/partners/wiki/horizontal.md'])
  })

  it('exits non-zero in strict mode when hard OKF requirements fail', async () => {
    const coworkRoot = join(tempRoot, 'cowork-wiki')
    await writeFixture(coworkRoot, 'agents/partners/wiki/legacy.md', '# Legacy note\n')

    const result = spawnSync('node', [script, '--root', coworkRoot, '--domain', 'agents/partners', '--sections', 'wiki', '--strict'], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('missing type: 1')
  })

  it('writes metadata-only export under repo tmp when explicitly requested', async () => {
    const coworkRoot = join(tempRoot, 'cowork-wiki')
    const exportDir = join(process.cwd(), 'tmp', `okf-test-${Date.now()}`)
    await writeFixture(coworkRoot, 'agents/partners/wiki/source.md', `---
type: Source
title: Source note
visibility: internal
---
# Source note
`)

    try {
      const output = execFileSync('node', [
        script,
        '--root', coworkRoot,
        '--domain', 'agents/partners',
        '--sections', 'wiki',
        '--write-export',
        '--export-dir', exportDir,
        '--json',
      ], { encoding: 'utf8' })
      const report = JSON.parse(output)

      expect(report.export.reportPath).toBe(join(exportDir, 'okf-validation-report.json'))
      expect(report.export.manifestPath).toBe(join(exportDir, 'okf-files.jsonl'))
      expect(report.export.copiedMarkdown).toBe(0)
      expect(report.summary.writeExport).toBe(true)
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  })
})
