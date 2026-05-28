import {
  contextTypeFromMentionNamespace,
  extractCurrentPageContextCommand,
  findActiveContextMention,
  findActiveContextTypePrompt,
  removeMentionToken,
  replaceTypePromptToken,
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
    })).toBe('Check with me')
  })

  it('detects bare and partial @reference type prompts', () => {
    expect(findActiveContextTypePrompt('Compare @')).toMatchObject({
      token: '@',
      query: '',
      start: 8,
      end: 9,
    })
    expect(findActiveContextTypePrompt('Compare @pr')).toMatchObject({
      token: '@pr',
      query: 'pr',
      start: 8,
      end: 11,
    })
    expect(replaceTypePromptToken('Compare @pr', { start: 8, end: 11 }, 'projects')).toBe('Compare @projects:')
  })
})
