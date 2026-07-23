import { buildEmailContextPresentation } from '@/lib/mailbox/emailContextPresentation'

describe('buildEmailContextPresentation', () => {
  it('returns an email contextRef and open_context uiAction for Messages canvas handoff', () => {
    const presentation = buildEmailContextPresentation({
      id: 'draft-1',
      subject: 'Proposal follow-up',
      snippet: 'Thanks for the call',
      from: 'me@example.com',
      to: ['lead@example.com'],
    })

    expect(presentation.contextRef).toMatchObject({
      type: 'email',
      id: 'draft-1',
      label: 'Proposal follow-up',
      origin: 'manual',
    })
    expect(presentation.contextRef.summary).toContain('from: me@example.com')
    expect(presentation.uiActions).toEqual([
      {
        id: 'open-email-draft:draft-1',
        type: 'open_context',
        label: 'Review email draft',
        variant: 'primary',
        payload: {
          kind: 'email',
          id: 'draft-1',
          label: 'Proposal follow-up',
        },
      },
    ])
  })
})
