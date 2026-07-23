import {
  buildChatExportFilename,
  formatChatExportMarkdown,
} from '@/lib/conversations/export-chat'

describe('formatChatExportMarkdown', () => {
  it('renders a titled transcript with speakers in chronological order', () => {
    const markdown = formatChatExportMarkdown({
      title: 'Hunt and Gun - CRM',
      conversationId: 'conv_123',
      exportedAt: new Date('2026-07-23T12:00:00.000Z'),
      messages: [
        {
          authorKind: 'agent',
          authorDisplayName: 'Pip',
          content: 'Second reply',
          createdAt: { seconds: 200 },
          model: 'gpt-5',
        },
        {
          authorKind: 'user',
          authorDisplayName: 'Peet',
          content: 'First question',
          createdAt: { seconds: 100 },
        },
      ],
    })

    expect(markdown).toContain('# Hunt and Gun - CRM')
    expect(markdown).toContain('Conversation ID: `conv_123`')
    expect(markdown).toContain('Messages: 2')
    expect(markdown.indexOf('## Peet')).toBeLessThan(markdown.indexOf('## Pip'))
    expect(markdown).toContain('First question')
    expect(markdown).toContain('Second reply')
    expect(markdown).toContain('model: gpt-5')
  })

  it('includes attachments and empty-state copy', () => {
    const empty = formatChatExportMarkdown({
      title: 'Empty',
      exportedAt: new Date('2026-07-23T12:00:00.000Z'),
      messages: [],
    })
    expect(empty).toContain('_No messages in this conversation._')

    const withAttachment = formatChatExportMarkdown({
      title: 'Files',
      exportedAt: new Date('2026-07-23T12:00:00.000Z'),
      messages: [
        {
          authorKind: 'user',
          authorDisplayName: 'You',
          content: 'See attached',
          createdAt: '2026-07-23T11:00:00.000Z',
          attachments: [{ name: 'spec.md', url: 'https://example.com/spec.md' }],
        },
      ],
    })
    expect(withAttachment).toContain('[spec.md](https://example.com/spec.md)')
  })
})

describe('buildChatExportFilename', () => {
  it('slugifies the title and stamps the date', () => {
    expect(buildChatExportFilename('Hunt and Gun - CRM', new Date('2026-07-23T12:00:00.000Z')))
      .toBe('Hunt-and-Gun-CRM-2026-07-23.md')
  })

  it('falls back when title is blank', () => {
    expect(buildChatExportFilename('   ', new Date('2026-07-23T12:00:00.000Z')))
      .toBe('conversation-2026-07-23.md')
  })
})
