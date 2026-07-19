import {
  contextTypeFromMentionNamespace,
  extractCurrentPageContextCommand,
  filterContextReferenceMentionOptions,
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

  it('supports CRM businesses and products as mention namespaces', () => {
    expect(contextTypeFromMentionNamespace('businesses')).toBe('company')
    expect(contextTypeFromMentionNamespace('products')).toBe('product')
    expect(findActiveContextMention('Compare @products:retainer')).toMatchObject({
      namespace: 'products',
      type: 'product',
      query: 'retainer',
      token: '@products:retainer',
    })
  })

  it('removes only the selected mention token from the input', () => {
    expect(removeMentionToken('Check @projects:launch with me', {
      start: 6,
      end: 22,
    }, 5)).toBe('Check with me')
  })

  it('preserves draft whitespace byte-for-byte outside the mention and its inserted separator', () => {
    const draft = 'First line  \n\n  Keep   every space'
    const input = `${draft} @projects:launch`
    expect(removeMentionToken(input, {
      start: draft.length + 1,
      end: input.length,
    }, draft.length)).toBe(draft)

    expect(removeMentionToken('First line\n\n@projects:launch', {
      start: 12,
      end: 28,
    })).toBe('First line\n\n')

    expect(removeMentionToken('Keep trailing space @projects:launch', {
      start: 20,
      end: 36,
    }, null)).toBe('Keep trailing space ')
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

  it('lists businesses and products in bare @reference type prompts', () => {
    expect(filterContextReferenceMentionOptions('').map((option) => option.namespace)).toEqual(
      expect.arrayContaining(['businesses', 'products']),
    )
    expect(filterContextReferenceMentionOptions('bus')).toEqual([
      expect.objectContaining({ namespace: 'businesses', type: 'company' }),
    ])
    expect(filterContextReferenceMentionOptions('prod')).toEqual([
      expect.objectContaining({ namespace: 'products', type: 'product' }),
    ])
  })

  it('offers Studio and Studio artifact mention namespaces', () => {
    expect(contextTypeFromMentionNamespace('studios')).toBe('studio')
    expect(contextTypeFromMentionNamespace('studioartifacts')).toBe('studio_artifact')
    expect(filterContextReferenceMentionOptions('').map((option) => option.namespace)).toEqual(
      expect.arrayContaining(['studios', 'studioartifacts']),
    )
  })
})
