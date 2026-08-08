import { runAudit } from '@/lib/design-audit'

function rulesFor(source: string, opts: Record<string, unknown> = {}): string[] {
  const result = runAudit(source, opts)
  return result.findings.map((f) => f.rule)
}

describe('design-audit slop rules', () => {
  it('flags purple gradients (inline and style block)', () => {
    const html = `
      <html><body>
        <section style="background: linear-gradient(90deg, #7c3aed, #2563eb)"></section>
        <style>.hero { background-image: radial-gradient(circle, #a855f7, #1e3a8a); }</style>
      </body></html>`
    const rules = rulesFor(html)
    expect(rules).toContain('purple-gradients')
    const findings = runAudit(html).findings.filter((f) => f.rule === 'purple-gradients')
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag a non-purple gradient', () => {
    const html = `<div style="background: linear-gradient(90deg, #0f172a, #334155)"></div>`
    expect(rulesFor(html)).not.toContain('purple-gradients')
  })

  it('flags glassmorphism backdrop blur', () => {
    const html = `<div style="backdrop-filter: blur(12px); background: rgba(255,255,255,0.4)">glass</div>`
    expect(rulesFor(html)).toContain('glassmorphism')
  })

  it('flags gradient text', () => {
    const html = `<h1 style="background: linear-gradient(90deg, #7c3aed, #2563eb); -webkit-background-clip: text; color: transparent">Shiny</h1>`
    expect(rulesFor(html)).toContain('gradient-text')
  })

  it('flags dark glow shadows', () => {
    const html = `<div style="box-shadow: 0 0 40px rgba(124, 58, 237, 0.5)">orb</div>`
    expect(rulesFor(html)).toContain('dark-glow')
  })

  it('flags bounce easing', () => {
    const html = `<button style="transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1)">Go</button>`
    expect(rulesFor(html)).toContain('bounce-easing')
  })

  it('does not flag a standard ease', () => {
    const html = `<button style="transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)">Go</button>`
    expect(rulesFor(html)).not.toContain('bounce-easing')
  })

  it('flags side-tab accent borders (Tailwind)', () => {
    const html = `<div class="rounded-lg border-l-4 border-blue-500 p-4">card</div>`
    expect(rulesFor(html)).toContain('side-tab-borders')
  })

  it('flags border accent on a rounded element', () => {
    const html = `<div style="border: 4px solid #ef4444; border-radius: 12px">card</div>`
    expect(rulesFor(html)).toContain('border-accent-rounded')
  })

  it('flags nested cards (card in card in card)', () => {
    const html = `
      <div style="background:#fff;padding:16px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
        <div style="background:#fff;padding:16px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
          <div style="background:#fff;padding:16px;border-radius:8px">deep</div>
        </div>
      </div>`
    expect(rulesFor(html)).toContain('nested-cards')
  })

  it('flags icon-tile stacks', () => {
    const html = `
      <div class="grid">
        <div class="w-12 h-12 rounded-lg bg-blue-100"><svg></svg></div>
        <div class="w-12 h-12 rounded-lg bg-blue-100"><svg></svg></div>
        <div class="w-12 h-12 rounded-lg bg-blue-100"><svg></svg></div>
      </div>`
    expect(rulesFor(html)).toContain('icon-tile-stacks')
  })

  it('flags kicker/eyebrow labels above headings', () => {
    const html = `<div><span class="text-xs uppercase tracking-wider">Our Features</span><h2>Everything you need</h2></div>`
    expect(rulesFor(html)).toContain('kicker-eyebrow')
  })

  it('flags italic serif heroes', () => {
    const html = `<h1 style="font-family: Georgia, serif; font-style: italic">Beautifully Crafted</h1>`
    expect(rulesFor(html)).toContain('italic-serif-hero')
  })

  it('flags overused fonts and honors design-stack exemption', () => {
    const html = `<p style="font-family: 'Inter', sans-serif">Body</p>`
    expect(rulesFor(html)).toContain('overused-fonts')
    const withDesign = runAudit(html, {
      designSystem: { palette: [], fonts: ['Inter'], radii: [], fontSize: [], source: 'test' },
    })
    expect(withDesign.findings.map((f) => f.rule)).not.toContain('overused-fonts')
  })

  it('flags flat type hierarchy', () => {
    const html = `<h1 style="font-size: 28px">Title</h1><h2 style="font-size: 24px">Sub</h2>`
    expect(rulesFor(html)).toContain('flat-type-hierarchy')
  })

  it('flags em-dash overuse', () => {
    const html = `<p>One — two — three — four — five — and six em-dashes in one line — that is far too many.</p>`
    expect(rulesFor(html)).toContain('em-dash-overuse')
  })

  it('flags buzzwords', () => {
    const html = `<p>We will elevate your business, unleash potential, and deliver a seamless experience.</p>`
    const rules = rulesFor(html)
    expect(rules).toContain('buzzwords')
  })

  it('does not flag a clean page', () => {
    const html = `<html><body><main><h1>Heading</h1><p>Plain copy without any slop markers here.</p></main></body></html>`
    const result = runAudit(html)
    const slopIds = [
      'purple-gradients', 'glassmorphism', 'gradient-text', 'dark-glow', 'bounce-easing',
      'side-tab-borders', 'border-accent-rounded', 'nested-cards', 'icon-tile-stacks',
      'kicker-eyebrow', 'italic-serif-hero', 'overused-fonts', 'flat-type-hierarchy',
      'em-dash-overuse', 'buzzwords',
    ]
    for (const id of slopIds) {
      expect(result.findings.map((f) => f.rule)).not.toContain(id)
    }
  })
})
