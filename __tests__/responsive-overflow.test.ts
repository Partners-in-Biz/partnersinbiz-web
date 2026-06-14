import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

describe('responsive overflow hardening', () => {
  it('keeps global app shells from leaking horizontal overflow at mobile/tablet/desktop widths', () => {
    const css = readFileSync(path.join(repoRoot, 'app/globals.css'), 'utf8')

    expect(css).toContain('overflow-x: clip')
    expect(css).toContain('.pib-app-shell *')
    expect(css).toContain('min-width: 0')
    expect(css).toContain('.pib-app-shell-main')
    expect(css).toContain('overflow-x: hidden')
    expect(css).toContain('.pib-dialog-body')
    expect(css).toContain('overflow-x: hidden')
  })

  it('sizes generated popup and slide-in lead forms within narrow mobile viewports', () => {
    const widgetRoute = readFileSync(path.join(repoRoot, 'app/embed/newsletter/[sourceId]/widget.js/route.ts'), 'utf8')

    expect(widgetRoute).toContain("maxWidth: 'min(460px, calc(100vw - 24px))'")
    expect(widgetRoute).toContain("maxHeight: 'calc(100dvh - 24px)'")
    expect(widgetRoute).toContain("overflowY: 'auto'")
    expect(widgetRoute).toContain("width: 'min(320px, calc(100vw - 24px))'")
    expect(widgetRoute).toContain("maxWidth: 'calc(100vw - 24px)'")
    expect(widgetRoute).toContain("left = '12px'")
    expect(widgetRoute).toContain("right = '12px'")
  })
})
