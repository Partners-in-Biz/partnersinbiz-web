import { readFileSync } from 'node:fs'
import path from 'node:path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('chat danger theme', () => {
  const css = source('app/globals.css')

  it('renders failed-message banners as ink on the chat surface with a danger rail', () => {
    const banner = cssBlock(css, '.pib-chat-danger-banner')
    expect(banner).toContain('color: var(--color-pib-text)')
    expect(banner).toContain('background: var(--color-pib-surface)')
    expect(banner).toContain('var(--st-danger)')
    expect(banner).not.toMatch(/color: var\(--st-danger\)/)
    expect(banner).not.toMatch(/color: var\(--color-on-error-container\)/)
  })

  it('never paints danger chips as danger text on a danger fill', () => {
    const chip = cssBlock(css, '.pib-chat-danger')
    expect(chip).toContain('color: var(--color-pib-text)')
    expect(chip).toContain('background: var(--color-pib-surface)')
    expect(chip).not.toContain('background: var(--color-error-container)')
    expect(chip).not.toMatch(/color: var\(--st-danger\)/)
  })

  it('keeps the Messages failed bubble and dock alerts off Tailwind red-on-red utilities', () => {
    const bubble = source('components/chat/MessageBubble.tsx')
    const failedBubbleLine = bubble.split('\n').find((line) => line.includes('pib-chat-danger-banner max-w-full'))
    expect(failedBubbleLine).toBeDefined()
    expect(failedBubbleLine).not.toMatch(/(?:text|bg|border)-red-/)

    const chat = source('components/chat/UnifiedChat.tsx')
    const alerts = chat.split('\n').filter((line) => line.includes('role="alert"') && line.includes('border-t'))
    expect(alerts.length).toBeGreaterThanOrEqual(2)
    for (const line of alerts) {
      expect(line).toContain('pib-chat-danger-banner')
      expect(line).not.toMatch(/(?:text|bg|border)-red-/)
    }
  })
})
