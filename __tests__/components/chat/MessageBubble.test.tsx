import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'

function closestMessageGroup(element: Element): HTMLElement | null {
  let node: Element | null = element
  while (node) {
    if (node instanceof HTMLElement && node.className.includes('group/message')) return node
    node = node.parentElement
  }
  return null
}

describe('MessageBubble', () => {
  it('keeps long mobile chat text inside the viewport instead of forcing horizontal scroll', () => {
    const longToken = 'https://example.com/' + 'unbroken-mobile-overflow-token-'.repeat(12)

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: longToken,
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    const messageText = screen.getByText(longToken)
    expect(messageText).toHaveClass('max-w-full', 'overflow-hidden', 'break-words', '[overflow-wrap:anywhere]')
    expect(closestMessageGroup(messageText)).toHaveClass('min-w-0')
  })

  it('keeps the user bubble clamped for long pasted mobile text', () => {
    const longToken = 'Attachment:' + 'VeryLongScreenshotFilenameWithoutNaturalBreaks'.repeat(8)

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: longToken,
          authorKind: 'user',
          authorId: 'user-1',
          authorDisplayName: 'Peet',
          status: 'completed',
        }}
      />,
    )

    const messageText = screen.getByText(longToken)
    expect(messageText).toHaveClass('max-w-full', 'overflow-hidden', 'break-words', '[overflow-wrap:anywhere]')
    expect(closestMessageGroup(messageText)).toHaveClass('min-w-0')
  })

  it('renders image attachments as clickable previews', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'image',
          authorKind: 'user',
          authorId: 'user-1',
          authorDisplayName: 'Peet',
          status: 'completed',
          attachments: [
            {
              id: 'att-1',
              name: 'Screenshot 2026-05-19.png',
              url: 'https://cdn.example.com/screenshot.png',
              contentType: 'image/png',
              sizeBytes: 287436,
            },
          ],
        }}
      />,
    )

    const preview = screen.getByRole('button', { name: /open Screenshot 2026-05-19\.png/i })
    expect(preview).toBeInTheDocument()
    expect(screen.getByAltText('Screenshot 2026-05-19.png')).toHaveAttribute('src', 'https://cdn.example.com/screenshot.png')

    fireEvent.click(preview)

    expect(screen.getByRole('dialog', { name: /Screenshot 2026-05-19\.png/i })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Screenshot 2026-05-19.png' }).at(-1)).toHaveAttribute('src', 'https://cdn.example.com/screenshot.png')
  })

  it('turns bare URLs in chat text into clickable links with image previews', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Here is the page https://partnersinbiz.online and the image https://cdn.example.com/output.png',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    expect(screen.getByRole('link', { name: 'https://partnersinbiz.online' })).toHaveAttribute('href', 'https://partnersinbiz.online')
    expect(screen.getByRole('link', { name: 'https://cdn.example.com/output.png' })).toHaveAttribute('href', 'https://cdn.example.com/output.png')
    expect(screen.getByRole('img', { name: 'https://cdn.example.com/output.png' })).toHaveAttribute('src', 'https://cdn.example.com/output.png')
  })

  it('shows a full inline command console for agent tool events', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Done.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          events: [
            {
              event: 'tool.started',
              tool: 'terminal',
              input: 'npm test -- --runInBand',
              timestamp: 1_770_000_000,
            },
            {
              event: 'tool.completed',
              tool: 'terminal',
              input: 'npm test -- --runInBand',
              stdout: 'PASS __tests__/components/chat/MessageBubble.test.tsx',
              exitCode: 0,
              durationMs: 842,
              timestamp: 1_770_000_002,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Inline command console')).toBeInTheDocument()
    expect(screen.getAllByText('terminal').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText((content) => content.includes('$ npm test -- --runInBand')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText((content) => content.includes('PASS __tests__/components/chat/MessageBubble.test.tsx'))).toBeInTheDocument()
    expect(screen.getByText(/exit 0/)).toBeInTheDocument()
  })

  it('renders assistant markdown, mermaid-style diagrams, and inline SVG visually instead of as raw prose', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: [
            '### Visual options',
            '',
            '- Plain copy',
            '- **Structured** content',
            '',
            'flowchart TD',
            'A[Client request] --> B[Pip resolves org/client]',
            'B --> C[Specialist agent handles work]',
            '',
            '<svg width="120" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="40" fill="#fff"/><text x="8" y="24">SVG card</text></svg>',
          ].join('\n'),
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Visual options' })).toBeInTheDocument()
    expect(screen.getByText('Plain copy').closest('li')).toBeInTheDocument()
    expect(screen.getByText('Structured')).toHaveClass('font-semibold')
    expect(screen.getByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(screen.getByText('Client request')).toBeInTheDocument()
    expect(screen.queryByText(/flowchart TD/)).not.toBeInTheDocument()
    expect(screen.getByText('SVG card')).toBeInTheDocument()
    expect(screen.queryByText(/<svg width/)).not.toBeInTheDocument()
  })

  it('renders structured rich parts and dispatches UI actions from the message payload', () => {
    const handleAction = jest.fn()
    const Bubble = MessageBubble as any

    render(
      <Bubble
        currentUserUid="user-1"
        onUiAction={handleAction}
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Fallback text',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          richParts: [
            { type: 'markdown', content: '### Launch plan\n- **Approve** final copy' },
            { type: 'code', language: 'ts', code: 'const ready = true' },
            {
              type: 'table',
              caption: 'Channel mix',
              columns: ['Channel', 'Status'],
              rows: [['Email', 'Ready'], ['LinkedIn', 'Draft']],
            },
            { type: 'image', url: 'https://cdn.example.com/ad.png', alt: 'Ad preview', caption: 'Primary ad' },
            { type: 'file', url: 'https://cdn.example.com/brief.pdf', name: 'Launch brief.pdf', sizeBytes: 2048 },
            { type: 'status', title: 'Checks passed', status: 'completed', body: 'All assets are ready.' },
            { type: 'approval', actionId: 'approval-1', title: 'Approve publish?', choices: ['once', 'deny'] },
            { type: 'clarify', actionId: 'clarify-tone', question: 'Which tone should I use?', choices: ['Direct', 'Warm'] },
            {
              type: 'model_picker',
              actionId: 'model-depth',
              title: 'Choose model depth',
              models: [{ id: 'deep', label: 'Deep review' }],
            },
          ],
          uiActions: [
            { id: 'approve-once', actionId: 'approval-1', type: 'approve', label: 'Allow once', value: 'once' },
            { id: 'choose-direct', actionId: 'clarify-tone', type: 'choose', label: 'Direct', value: 'Direct' },
            { id: 'open-brief', type: 'open', label: 'Open brief', url: 'https://cdn.example.com/brief.pdf' },
          ],
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Launch plan' })).toBeInTheDocument()
    expect(screen.getByText('const ready = true')).toBeInTheDocument()
    expect(screen.getByText('Channel mix')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Channel' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ad preview' })).toHaveAttribute('src', 'https://cdn.example.com/ad.png')
    expect(screen.getByRole('link', { name: /Launch brief\.pdf/i })).toHaveAttribute('href', 'https://cdn.example.com/brief.pdf')
    expect(screen.getByText('Checks passed')).toBeInTheDocument()
    expect(screen.getByText('Approve publish?')).toBeInTheDocument()
    expect(screen.getByText('Which tone should I use?')).toBeInTheDocument()
    expect(screen.getByText('Choose model depth')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(handleAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-1' }),
      expect.objectContaining({ id: 'approve-once', type: 'approve', value: 'once' }),
    )
  })

  it('renders a rich JSON content envelope instead of showing raw JSON text', async () => {
    const handleAction = jest.fn()
    const Bubble = MessageBubble as any
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: jest.fn(() => true),
    })
    const richJsonText = JSON.stringify({
      rich_parts: [
        { type: 'markdown', content: '### PiB Rich Chat Contract Smoke Test\nThis should render as markdown.' },
        {
          type: 'status_card',
          title: 'Rich chat contract smoke test',
          status: 'ready_for_review',
          body: 'No external action was performed.',
        },
      ],
      ui_actions: [
        { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'PIB rich chat smoke test' },
      ],
    }, null, 2)

    render(
      <Bubble
        currentUserUid="user-1"
        onUiAction={handleAction}
        message={{
          id: 'msg-json',
          conversationId: 'conv-1',
          role: 'assistant',
          content: richJsonText,
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'PiB Rich Chat Contract Smoke Test' })).toBeInTheDocument()
    expect(screen.getByText('Rich chat contract smoke test')).toBeInTheDocument()
    expect(screen.getByText('No external action was performed.')).toBeInTheDocument()
    expect(screen.queryByText(/"rich_parts"/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }))
    await waitFor(() => {
      expect(handleAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-json' }),
        expect.objectContaining({ id: 'copy-summary', type: 'copy', value: 'PIB rich chat smoke test' }),
      )
    })
  })

  it('hides incomplete streamed rich JSON envelopes instead of printing raw fragments', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-streaming-json',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '{\n  "rich_parts": [\n    { "type": "markdown", "content": "### Streaming',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'streaming',
        }}
      />,
    )

    expect(screen.queryByText(/"rich_parts"/)).not.toBeInTheDocument()
    expect(screen.getByText('Waiting for agent activity...')).toBeInTheDocument()
  })
})
