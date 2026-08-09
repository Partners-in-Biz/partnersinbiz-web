import { runAudit } from '@/lib/design-audit'

function rulesFor(source: string, opts: Record<string, unknown> = {}): string[] {
  return runAudit(source, opts).findings.map((f) => f.rule)
}

describe('design-audit quality + a11y rules', () => {
  it('flags broken images (missing src)', () => {
    const html = `<img alt="broken">`
    expect(rulesFor(html)).toContain('broken-images')
  })

  it('flags images without alt', () => {
    const html = `<img src="/a.png">`
    const rules = rulesFor(html)
    expect(rules).toContain('missing-alt')
    expect(rules).not.toContain('broken-images')
  })

  it('flags unlabeled controls', () => {
    const html = `<form><input type="text"></form>`
    expect(rulesFor(html)).toContain('unlabeled-controls')
  })

  it('accepts labeled controls', () => {
    const html = `<form><label>Name <input type="text" aria-label="Name"></label><input type="hidden" name="id"></form>`
    expect(rulesFor(html)).not.toContain('unlabeled-controls')
  })

  it('accepts controls labeled via the pib-label htmlFor/id convention', () => {
    const html = `<form>
      <label htmlFor="project-name" className="pib-label">Project Name</label>
      <input id="project-name" type="text" className="pib-input w-full" />
      <label htmlFor="project-status" className="pib-label">Status</label>
      <select id="project-status" className="pib-select w-full"></select>
      <label htmlFor="project-notes" className="pib-label">Notes</label>
      <textarea id="project-notes" className="pib-textarea w-full"></textarea>
    </form>`
    expect(rulesFor(html)).not.toContain('unlabeled-controls')
  })

  it('still flags controls whose id is not referenced by any label', () => {
    const html = `<form>
      <label htmlFor="other-field" className="pib-label">Other</label>
      <input id="project-name" type="text" className="pib-input w-full" />
    </form>`
    expect(rulesFor(html)).toContain('unlabeled-controls')
  })

  it('reports runtime script errors (browser mode)', () => {
    const result = runAudit('<p>hi</p>', { runtimeErrors: ['TypeError: x is not a function (main.js:12)'] })
    expect(result.findings.map((f) => f.rule)).toContain('script-errors')
    expect(result.findings.find((f) => f.rule === 'script-errors')?.severity).toBe('P0')
  })

  it('flags content invisible at rest', () => {
    const html = `<div style="opacity: 0">Important content hidden at rest</div>`
    expect(rulesFor(html)).toContain('content-invisible-at-rest')
  })

  it('does not flag aria-hidden or reveal-pattern content', () => {
    const html = `<div aria-hidden="true" style="opacity: 0">decorative</div><div class="animate-fade-in" style="opacity: 0">reveal</div>`
    expect(rulesFor(html)).not.toContain('content-invisible-at-rest')
  })

  it('does not flag Tailwind responsive-hidden toggles', () => {
    const html = `<div>
      <span class="hidden sm:inline">Desktop label</span>
      <table class="hidden w-full min-w-[760px] md:table"><tr><td>Rows</td></tr></table>
      <div class="pib-card mb-4 hidden lg:block">Chat card</div>
    </div>`
    expect(rulesFor(html)).not.toContain('content-invisible-at-rest')
  })

  it('still flags a plain hidden element without a breakpoint restore', () => {
    const html = `<div class="hidden">Genuinely hidden content</div>`
    expect(rulesFor(html)).toContain('content-invisible-at-rest')
  })

  it('flags cramped padding on colored containers', () => {
    const html = `<div style="background: #fff; padding: 2px">Tight box</div>`
    expect(rulesFor(html)).toContain('cramped-padding')
  })

  it('does not flag comfortable padding', () => {
    const html = `<div style="background: #fff; padding: 16px">Comfortable</div>`
    expect(rulesFor(html)).not.toContain('cramped-padding')
  })

  it('flags long single-line paragraphs', () => {
    const long = 'x'.repeat(140)
    const html = `<p>${long}</p>`
    expect(rulesFor(html)).toContain('long-line-length')
  })

  it('flags tight line height', () => {
    const html = `<p style="line-height: 1.2">${'word '.repeat(12)}</p>`
    expect(rulesFor(html)).toContain('tight-line-height')
  })

  it('flags wide letter spacing on body text', () => {
    const html = `<p style="letter-spacing: 0.12em">${'word '.repeat(8)}</p>`
    expect(rulesFor(html)).toContain('wide-letter-spacing')
  })

  it('flags justified text', () => {
    const html = `<p style="text-align: justify">Justified copy here.</p>`
    expect(rulesFor(html)).toContain('justified-text')
  })

  it('flags low-contrast text when both colors are inline', () => {
    const html = `<p style="color: #f5f5f5; background-color: #ffffff">Ghost text</p>`
    expect(rulesFor(html)).toContain('low-contrast-text')
  })

  it('passes high-contrast text', () => {
    const html = `<p style="color: #000000; background-color: #ffffff">Black on white</p>`
    expect(rulesFor(html)).not.toContain('low-contrast-text')
  })

  it('skips contrast when colors are not resolvable', () => {
    const html = `<p>Plain text, no inline colors.</p>`
    expect(rulesFor(html)).not.toContain('low-contrast-text')
  })

  it('uses computed styles in browser mode', () => {
    const html = `<p class="body">Muted text</p>`
    const result = runAudit(html, {
      computedStyles: {
        'p.body:nth-of-type(1)': { color: '#eeeeee', 'background-color': '#ffffff', 'font-size': '14px', 'font-weight': '400' },
      },
    })
    expect(result.findings.map((f) => f.rule)).toContain('low-contrast-text')
  })

  it('flags skipped heading levels', () => {
    const html = `<h1>Title</h1><h3>Skipped h2</h3>`
    expect(rulesFor(html)).toContain('skipped-heading-levels')
  })

  it('flags tiny body text and undersized functional text', () => {
    const html = `<p style="font-size: 10px">Small body</p><button style="font-size: 9px">Tiny</button>`
    const rules = rulesFor(html)
    expect(rules).toContain('tiny-body-text')
    expect(rules).toContain('undersized-functional-text')
  })

  it('flags tiny text from Tailwind arbitrary values', () => {
    const html = `<p class="text-[10px]">Tiny</p>`
    expect(rulesFor(html)).toContain('tiny-body-text')
  })
})
