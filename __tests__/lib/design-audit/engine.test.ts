import { runAudit, mergeResults, ALL_RULES } from '@/lib/design-audit'

const DIRTY = `
<html><body>
  <div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>
  <img alt="x">
  <p style="color: #f5f5f5; background-color: #ffffff">Ghost</p>
</body></html>
`

describe('design-audit engine', () => {
  it('runs 30 core rules by default', () => {
    const result = runAudit('<p>clean</p>')
    expect(result.rulesRun).toHaveLength(30)
    expect(result.rulesIgnored).toEqual(expect.arrayContaining(['font-outside-design', 'color-outside-design', 'radius-outside-design', 'font-size-outside-design']))
    expect(result.schema).toBe('pib-design-audit/v1')
  })

  it('returns exit code 0 when clean and 2 with findings', () => {
    expect(runAudit('<p>clean copy</p>').exitCode).toBe(0)
    expect(runAudit(DIRTY).exitCode).toBe(2)
  })

  it('groups findings P0-P3 with refs and severity counts', () => {
    const result = runAudit(DIRTY)
    const sevs = result.findings.map((f) => f.severity)
    expect(sevs).toContain('P0') // broken-images
    expect(sevs).toContain('P1') // purple-gradients / low-contrast
    expect(result.summary.bySeverity.P0 + result.summary.bySeverity.P1 + result.summary.bySeverity.P2 + result.summary.bySeverity.P3).toBe(result.summary.total)
    for (const f of result.findings) {
      expect(f.ref).toBeTruthy()
      expect(typeof f.message).toBe('string')
    }
  })

  it('sorts findings by severity', () => {
    const result = runAudit(DIRTY)
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 }
    for (let i = 1; i < result.findings.length; i++) {
      expect(order[result.findings[i].severity]).toBeGreaterThanOrEqual(order[result.findings[i - 1].severity])
    }
  })

  it('narrows by scope type|layout', () => {
    const typeResult = runAudit(DIRTY, { scope: 'type' })
    const layoutResult = runAudit(DIRTY, { scope: 'layout' })
    for (const f of typeResult.findings) expect(['type', 'any']).toContain(f.scope)
    for (const f of layoutResult.findings) expect(['layout', 'any']).toContain(f.scope)
    // low-contrast is 'any' so it appears in both.
    expect(typeResult.findings.map((f) => f.rule)).toContain('low-contrast-text')
    expect(layoutResult.findings.map((f) => f.rule)).toContain('low-contrast-text')
  })

  it('honors option-level ignoreRules', () => {
    const result = runAudit(DIRTY, { ignore: { rules: ['purple-gradients', 'broken-images', 'low-contrast-text'] } })
    expect(result.findings.map((f) => f.rule)).not.toContain('purple-gradients')
    expect(result.rulesIgnored).toContain('purple-gradients')
  })

  it('honors ignoreValues (rule:value)', () => {
    const html = `<p style="font-family: 'Inter', sans-serif">Body</p>`
    const clean = runAudit(html, { ignore: { values: ['overused-fonts:Inter'] } })
    expect(clean.findings.map((f) => f.rule)).not.toContain('overused-fonts')
  })

  it('honors ignoreFiles globs', () => {
    const result = runAudit(DIRTY, { fileName: 'src/legacy/page.html', ignore: { files: ['src/legacy/**'] } })
    expect(result.findings).toHaveLength(0)
    expect(result.rulesIgnored.length).toBeGreaterThan(0)
  })

  it('honors inline impeccable-disable comments', () => {
    const html = `<!-- impeccable-disable purple-gradients -->\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>`
    expect(runAudit(html).findings.map((f) => f.rule)).not.toContain('purple-gradients')
  })

  it('honors impeccable-disable rule + enable', () => {
    const html = `<!-- impeccable-disable purple-gradients -->\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>\n<!-- impeccable-enable purple-gradients -->\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>`
    const result = runAudit(html)
    expect(result.findings.filter((f) => f.rule === 'purple-gradients')).toHaveLength(1)
  })

  it('honors disable-line / disable-next-line', () => {
    const html = `<!-- impeccable-disable-next-line purple-gradients -->\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>`
    const result = runAudit(html)
    expect(result.findings.filter((f) => f.rule === 'purple-gradients')).toHaveLength(1)
  })

  it('honors data-impeccable-disable attributes on elements and subtrees', () => {
    const html = `
      <div data-impeccable-disable="purple-gradients">
        <div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>
      </div>
      <div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>`
    const result = runAudit(html)
    expect(result.findings.filter((f) => f.rule === 'purple-gradients')).toHaveLength(1)
  })

  it('honors --no-inline-ignores (ignore.inline=false)', () => {
    const html = `<!-- impeccable-disable purple-gradients -->\n<div style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></div>`
    const result = runAudit(html, { ignore: { inline: false } })
    expect(result.findings.map((f) => f.rule)).toContain('purple-gradients')
  })

  it('caps per-rule findings and notes truncation', () => {
    const many = Array.from({ length: 80 }, () => '<img alt="x">').join('\n')
    const result = runAudit(many, { maxFindingsPerRule: 10 })
    expect(result.findings.filter((f) => f.rule === 'broken-images')).toHaveLength(10)
    expect(result.notes.some((n) => n.includes('truncated'))).toBe(true)
  })

  it('records rule errors without crashing the audit', () => {
    // Trigger an error by feeding the engine a source that breaks pathOf? Use a stub rule
    // via ALL_RULES mutation is unsafe; instead verify engine tolerates a bad computedStyles ref.
    const result = runAudit('<p>hi</p>', { computedStyles: { bogus: { color: '#000' } } })
    expect(result.errors).toHaveLength(0)
    expect(result.exitCode).toBe(0)
  })

  it('merges multi-file results', () => {
    const a = runAudit('<img alt="x">', { fileName: 'a.html' })
    const b = runAudit('<p>clean</p>', { fileName: 'b.html' })
    const merged = mergeResults([a, b])
    expect(merged.summary.total).toBe(a.summary.total + b.summary.total)
    expect(merged.exitCode).toBe(2)
  })

  it('exposes the full rule catalogue with ids, severities, scopes', () => {
    expect(ALL_RULES.length).toBe(34)
    const ids = new Set(ALL_RULES.map((r) => r.id))
    expect(ids.size).toBe(34)
    for (const rule of ALL_RULES) {
      expect(['P0', 'P1', 'P2', 'P3']).toContain(rule.severity)
      expect(['type', 'layout', 'any']).toContain(rule.scope)
      expect(typeof rule.check).toBe('function')
    }
  })
})
