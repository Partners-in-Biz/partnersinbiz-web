import {
  contextTypeFromMentionNamespace,
  extractCurrentPageContextCommand,
  findActiveContextMention,
  removeMentionToken,
} from '@/lib/context-references/composer'

describe('context reference composer helpers', () => {
  it('detects and strips the current-page context phrase', () => {
    expect(extractCurrentPageContextCommand('use current page as context')).toEqual({
      shouldUseCurrentPage: true,
      content: '',
    })

    expect(extractCurrentPageContextCommand('Use current page as context what should we do next?')).toEqual({
      shouldUseCurrentPage: true,
      content: 'what should we do next?',
    })
  })

  it('detects namespaced @reference searches at the cursor', () => {
    expect(findActiveContextMention('Please compare @projects:launch', 32)).toMatchObject({
      namespace: 'projects',
      type: 'project',
      query: 'launch',
      token: '@projects:launch',
    })
    expect(contextTypeFromMentionNamespace('docs')).toBe('document')
    expect(contextTypeFromMentionNamespace('emails')).toBe('email')
  })

  it('removes only the selected mention token from the input', () => {
    expect(removeMentionToken('Check @projects:launch with me', {
      start: 6,
      end: 22,
      token: '@projects:launch',
      namespace: 'projects',
      type: 'project',
      query: 'launch',
    })).toBe('Check with me')
  })
})
