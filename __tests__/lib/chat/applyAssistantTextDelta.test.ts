import { applyAssistantTextDelta } from '@/lib/chat/applyAssistantTextDelta'

describe('applyAssistantTextDelta', () => {
  it('appends true incremental tokens', () => {
    expect(applyAssistantTextDelta('Hello', ' world')).toBe('Hello world')
  })

  it('replaces cumulative full-text snapshots instead of duplicating', () => {
    const first = 'I am ready for the blog content.'
    const second = 'I am ready for the blog content. Please paste it here.'
    expect(applyAssistantTextDelta(first, second)).toBe(second)
    expect(applyAssistantTextDelta(second, second)).toBe(second)
  })

  it('ignores repeated full-paragraph replays', () => {
    const paragraph = 'I am ready for the blog content from the emails. Please paste it here, and I will take care of the formatting.'
    expect(applyAssistantTextDelta(paragraph, paragraph)).toBe(paragraph)
    expect(applyAssistantTextDelta(`${paragraph}\n\n`, paragraph)).toBe(`${paragraph}\n\n`)
  })
})
