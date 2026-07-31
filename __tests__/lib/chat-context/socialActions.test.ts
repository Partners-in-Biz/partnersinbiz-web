import { socialPostChatActions } from '@/lib/chat-context/adapters/social'

function post(status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { status, ...extra }
}

describe('social post chat actions', () => {
  it('lets organisation members submit drafts into the canonical review pipeline', () => {
    expect(socialPostChatActions({
      id: 'post 1',
      post: post('draft'),
      role: 'client',
    })).toEqual([expect.objectContaining({
      id: 'submit-social:post 1',
      label: 'Submit for review',
      href: '/api/v1/social/posts/post%201/submit',
      method: 'POST',
    })])
  })

  it('reserves QA approval for canonical admin roles', () => {
    expect(socialPostChatActions({
      id: 'post-1',
      post: post('qa_review'),
      role: 'client',
    })).toEqual([])
    expect(socialPostChatActions({
      id: 'post-1',
      post: post('qa_review'),
      role: 'admin',
    })).toEqual([expect.objectContaining({
      label: 'Approve QA review',
      href: '/api/v1/social/posts/post-1/qa-approve',
      requiresApproval: true,
    })])
  })

  it('offers final client approval to members at both current and legacy review states', () => {
    for (const status of ['client_review', 'pending_approval']) {
      expect(socialPostChatActions({
        id: 'post-1',
        post: post(status),
        role: 'client',
      })).toEqual([expect.objectContaining({
        label: 'Approve post',
        href: '/api/v1/social/posts/post-1/client-approve',
        requiresApproval: true,
      })])
    }
  })

  it('only offers publish to admins when final approval evidence exists', () => {
    expect(socialPostChatActions({
      id: 'post-1',
      post: post('approved', { approvedBy: 'reviewer-1' }),
      role: 'client',
    })).toEqual([])
    expect(socialPostChatActions({
      id: 'post-1',
      post: post('approved'),
      role: 'admin',
    })).toEqual([])
    expect(socialPostChatActions({
      id: 'post-1',
      post: post('failed', { approval: { clientApprovedBy: 'reviewer-1' } }),
      role: 'admin',
    })).toEqual([expect.objectContaining({
      label: 'Retry publishing',
      href: '/api/v1/social/posts/post-1/publish',
      requiresApproval: true,
    })])
  })

  it('does not invent rejection or regeneration actions without required feedback input', () => {
    expect(socialPostChatActions({
      id: 'post-1',
      post: post('regenerating'),
      role: 'admin',
    })).toEqual([])
    expect(socialPostChatActions({
      id: 'post-1',
      post: post('published', { approvedBy: 'reviewer-1' }),
      role: 'admin',
    })).toEqual([])
  })
})
