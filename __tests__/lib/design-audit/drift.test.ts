import { runAudit } from '@/lib/design-audit'
import { parseDesignMd, parseDesignJson, colorInPalette, fontInStack, radiusInScale, fontSizeInScale } from '@/lib/design-audit/design-context'

const DESIGN_MD = `
# Design System

## Colors
- Primary: #0F172A
- #64748B
- Accent: #2563EB

## Typography
- Display: "Space Grotesk"
- Inter

## Radii
- sm: 4px
- md: 8px
- lg: 12px

## Font Sizes
- 14px, 16px, 20px, 30px
`

describe('design-context parsing', () => {
  it('parses DESIGN.md sections', () => {
    const ds = parseDesignMd(DESIGN_MD)
    expect(ds.palette).toContain('#0f172a')
    expect(ds.palette).toContain('#2563eb')
    expect(ds.fonts).toEqual(expect.arrayContaining(['Space Grotesk', 'Inter']))
    expect(ds.radii).toEqual([4, 8, 12])
    expect(ds.fontSize).toEqual([14, 16, 20, 30])
  })

  it('parses design.json', () => {
    const ds = parseDesignJson(JSON.stringify({
      palette: ['#0F172A', '#64748B'],
      fonts: ['Inter'],
      radii: [4, 8, 12],
      fontSize: [14, 16, 20],
    }))
    expect(ds.palette).toContain('#0f172a')
    expect(ds.fonts).toEqual(['Inter'])
    expect(ds.radii).toEqual([4, 8, 12])
  })

  it('answers membership helpers', () => {
    const ds = parseDesignMd(DESIGN_MD)
    expect(colorInPalette(ds, '#0F172A')).toBe(true)
    expect(colorInPalette(ds, '#ff0000')).toBe(false)
    expect(fontInStack(ds, 'inter')).toBe(true)
    expect(fontInStack(ds, 'Comic Sans MS')).toBe(false)
    expect(radiusInScale(ds, 8)).toBe(true)
    expect(radiusInScale(ds, 9)).toBe(false)
    expect(fontSizeInScale(ds, 20)).toBe(true)
    expect(fontSizeInScale(ds, 21)).toBe(false)
  })
})

describe('design-audit drift rules', () => {
  it('does not run drift rules without design context', () => {
    const html = `<p style="font-family: 'Comic Sans MS'; color: #ff0000; border-radius: 14px; font-size: 13px">drift</p>`
    const result = runAudit(html)
    expect(result.findings.map((f) => f.rule)).not.toContain('font-outside-design')
    expect(result.rulesIgnored).toEqual(expect.arrayContaining(['font-outside-design', 'color-outside-design', 'radius-outside-design', 'font-size-outside-design']))
  })

  it('flags fonts, colors, radii and sizes outside DESIGN.md', () => {
    const html = `
      <p style="font-family: 'Comic Sans MS'; color: #ff0000; border-radius: 14px; font-size: 13px">drift</p>
      <p style="font-family: 'Inter'; color: #0f172a; border-radius: 8px; font-size: 16px">clean</p>`
    const result = runAudit(html, { designSystem: parseDesignMd(DESIGN_MD) })
    const rules = result.findings.map((f) => f.rule)
    expect(rules).toContain('font-outside-design')
    expect(rules).toContain('color-outside-design')
    expect(rules).toContain('radius-outside-design')
    expect(rules).toContain('font-size-outside-design')
    // The compliant paragraph produces no drift findings on its own.
    const driftRules = ['font-outside-design', 'color-outside-design', 'radius-outside-design', 'font-size-outside-design']
    for (const rule of driftRules) {
      const findings = result.findings.filter((f) => f.rule === rule)
      expect(findings.some((f) => f.ref.includes('p:nth-of-type(1)'))).toBe(true)
      expect(findings.some((f) => f.ref.includes('p:nth-of-type(2)'))).toBe(false)
    }
  })

  it('honors --no-design-system (designSystemEnabled false)', () => {
    const html = `<p style="font-family: 'Comic Sans MS'">drift</p>`
    const result = runAudit(html, { designSystem: parseDesignMd(DESIGN_MD), designSystemEnabled: false })
    expect(result.findings.map((f) => f.rule)).not.toContain('font-outside-design')
  })

  it('drift findings carry machine-ignorable values', () => {
    const html = `<p style="font-family: 'Comic Sans MS'">drift</p>`
    const result = runAudit(html, { designSystem: parseDesignMd(DESIGN_MD) })
    const f = result.findings.find((x) => x.rule === 'font-outside-design')
    expect(f?.value).toBe('Comic Sans MS')
  })
})
