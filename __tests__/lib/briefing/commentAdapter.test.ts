import { commentAdapter } from '@/lib/briefing/adapters/commentAdapter'

describe('commentAdapter priority extraction', () => {
  const baseComment = {
    id: 'comment-1',
    userId: 'agent:pip',
    userRole: 'ai' as const,
    text: 'placeholder',
  }

  it('treats agent resolution comments as progress instead of blocked', () => {
    expect(commentAdapter.extractPriority({
      ...baseComment,
      text: 'Unblocked by Pip after Peet reconnected access. Verified GSC property owner access and moved to done.',
    }, 'comment-1')).toBe('progress')
  })

  it('does not match blocked inside unblocked as a critical blocker', () => {
    expect(commentAdapter.extractPriority({
      ...baseComment,
      text: 'Checked after Peet connected socials. That clears the old Instagram-token issue and the task is unblocked.',
    }, 'comment-2')).toBe('progress')
  })

  it('keeps live blocker comments critical', () => {
    expect(commentAdapter.extractPriority({
      ...baseComment,
      text: 'Still blocked on Search Console access; cannot request indexing until Peet reconnects GSC.',
    }, 'comment-3')).toBe('critical')
  })
})
