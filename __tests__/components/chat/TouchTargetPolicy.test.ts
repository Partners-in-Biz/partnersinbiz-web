import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('Messages touch target policy', () => {
  it('keeps Sessions drawer controls touch-sized and conversation menus discoverable below xl', () => {
    const unifiedChat = source('components/chat/UnifiedChat.tsx')
    const sessions = unifiedChat.slice(
      unifiedChat.indexOf('{/* ── Left: conversation list'),
      unifiedChat.indexOf('{/* ── Right: active conversation'),
    )

    expect(sessions).not.toMatch(/className=(?:"|{`)[^\n]*(?:^|\s)(?:sm|md|lg):(?:h|w|min-h|min-w)-(?:[0-9]|10)(?:\s|["`])/m)
    expect(sessions).not.toMatch(/(?<!xl:)group-hover\/conv:flex/)
    expect(sessions).not.toContain('className="inline-flex h-8 w-8')
    expect(sessions).not.toContain('className="min-h-8')
    expect(sessions).not.toContain('className="min-h-9')
    expect(sessions).toContain('xl:group-hover/conv:flex')
  })

  it('keeps Context Canvas actions touch-sized through tablet breakpoints', () => {
    const contextSources = [
      'components/chat/context/ChatContextExperience.tsx',
      'components/chat/context/ContextDock.tsx',
      'components/chat/context/ContextArtifactCard.tsx',
      'components/chat/context/ContextAttentionMoment.tsx',
      'components/chat/context/ContextSelector.tsx',
      'components/chat/context/ContextPulse.tsx',
      'components/messages/hermes/RuntimeInspectorRail.tsx',
    ].map(source).join('\n')

    expect(contextSources).not.toMatch(/(?:sm|md|lg):(?:h|w|min-h|min-w)-(?:[0-9]|10)\b/)
    expect(contextSources).not.toContain('sm:h-9')
    expect(contextSources).toContain('min-h-11')
    expect(contextSources).toContain('xl:min-h-0')
  })
})
