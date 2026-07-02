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

  it('renders direct mp4 and webm rich video parts inline with mobile-safe controls and open fallbacks', () => {
    const { container } = render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Generated videos are ready.',
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
          richParts: [
            { type: 'video', url: 'https://cdn.example.com/higgsfield-output.mp4', name: 'Higgsfield MP4 output', mimeType: 'video/mp4' },
            { type: 'video', url: 'https://firebasestorage.googleapis.com/v0/b/pib/o/render.webm?alt=media&token=abc', name: 'Firebase WebM output', mimeType: 'video/webm' },
          ],
        }}
      />,
    )

    const videos = Array.from(container.querySelectorAll('video'))
    expect(videos).toHaveLength(2)
    expect(videos[0]).toHaveAttribute('src', 'https://cdn.example.com/higgsfield-output.mp4')
    expect(videos[0]).toHaveAttribute('playsinline')
    expect(videos[1]).toHaveAttribute('src', 'https://firebasestorage.googleapis.com/v0/b/pib/o/render.webm?alt=media&token=abc')
    expect(videos[1]).toHaveAttribute('playsinline')
    expect(screen.getByRole('link', { name: /open Higgsfield MP4 output/i })).toHaveAttribute('href', 'https://cdn.example.com/higgsfield-output.mp4')
    expect(screen.getByRole('link', { name: /open Firebase WebM output/i })).toHaveAttribute('href', 'https://firebasestorage.googleapis.com/v0/b/pib/o/render.webm?alt=media&token=abc')
  })

  it('uses an explicit browser fallback instead of embedding non-direct Google Drive video links', () => {
    const { container } = render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Generated Drive video is ready.',
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
          richParts: [
            { type: 'video', url: 'https://drive.google.com/file/d/abc123/view?usp=drive_link', name: 'Higgsfield Drive output', mimeType: 'video/mp4' },
          ],
        }}
      />,
    )

    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByText(/This generated video link cannot be previewed safely inline/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open Higgsfield Drive output in browser/i })).toHaveAttribute('href', 'https://drive.google.com/file/d/abc123/view?usp=drive_link')
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


  it('standardises device-login instructions into a mobile-friendly auth card with separate URL and code copy actions', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const authUrl = 'https://auth.higgsfield.ai/device'
    const code = 'HF-24K9-ZQ7P'

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-auth',
          conversationId: 'conv-1',
          role: 'assistant',
          content: `Higgsfield needs device login. Visit ${authUrl} and enter code ${code}. This code expires in 15 minutes. Full link: https://auth.higgsfield.ai/device?user_code=${code}&client_id=${'x'.repeat(120)}`,
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
        }}
      />,
    )

    const card = screen.getByLabelText('Device login instructions')
    expect(card).toHaveClass('max-w-full', 'overflow-hidden')
    expect(screen.getByText('Higgsfield device login')).toBeInTheDocument()
    expect(screen.getByText(authUrl)).toHaveClass('break-words', '[overflow-wrap:anywhere]')
    expect(screen.getByText(code)).toBeInTheDocument()
    expect(screen.getByText(/expires in 15 minutes/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy auth URL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy auth code' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(authUrl)
      expect(writeText).toHaveBeenCalledWith(code)
    })
    expect(screen.getByRole('link', { name: /open full auth link/i })).toHaveAttribute('href', expect.stringContaining('user_code=HF-24K9-ZQ7P'))
  })

  it('renders device auth cards for Hermes/Higgsfield tool output and keeps long full links from overflowing', () => {
    const fullLink = `https://login.example.com/activate?user_code=CODE-7788&state=${'state-token-'.repeat(30)}`

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-tool-auth',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Waiting on tool login.',
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
          richParts: [
            {
              type: 'tool_output',
              tool: 'higgsfield',
              stdout: `To authenticate, open ${fullLink} and enter code CODE-7788. Status: pending, expires at 2026-06-20T12:30:00Z`,
            },
          ],
        }}
      />,
    )

    const card = screen.getByLabelText('Device login instructions')
    expect(card).toHaveClass('max-w-full', 'overflow-hidden')
    expect(screen.getByText('https://login.example.com/activate')).toBeInTheDocument()
    expect(screen.getByText('CODE-7788')).toBeInTheDocument()
    expect(screen.getByText(/status: pending/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open full auth link/i })).toHaveClass('max-w-full', 'truncate')
    expect(screen.queryByText(fullLink)).not.toBeInTheDocument()
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
            {
              type: 'approval_card',
              title: 'CMP proposal follow-up',
              body: 'Proposal and CRM notes are ready for a CEO decision.',
              statusLabel: 'Needs CEO decision',
              evidence: ['Deal is in active proposal stage', 'Follow-up copy is drafted but not sent'],
              dataSkill: 'crm-sales:gather-deal-context',
              analysisQuestion: 'Which follow-up has the highest chance of moving CMP to a meeting?',
              decisions: [
                { label: 'Approve WhatsApp follow-up', required: true },
                'Ask Pip to revise the tone',
              ],
              recommendation: 'Approve the WhatsApp follow-up and ask for a meeting window.',
              replyTemplate: 'Approved: send the CMP WhatsApp follow-up with a meeting-window ask.',
              safetyNote: 'No external message is sent until this approval is posted in chat.',
            },
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
    expect(screen.getByLabelText('CMP proposal follow-up')).toBeInTheDocument()
    expect(screen.getByText('Needs CEO decision')).toBeInTheDocument()
    expect(screen.getByText('Deal is in active proposal stage')).toBeInTheDocument()
    expect(screen.getByText('crm-sales:gather-deal-context')).toBeInTheDocument()
    expect(screen.getByText('Approve WhatsApp follow-up')).toBeInTheDocument()
    expect(screen.getByText('Approved: send the CMP WhatsApp follow-up with a meeting-window ask.')).toBeInTheDocument()
    expect(screen.getByText('Which tone should I use?')).toBeInTheDocument()
    expect(screen.getByText('Choose model depth')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(handleAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-1' }),
      expect.objectContaining({ id: 'approve-once', type: 'approve', value: 'once' }),
    )
  })

  it('lets approval-card decisions and reply templates be added to the chat composer', () => {
    const handleQuote = jest.fn()
    const Bubble = MessageBubble as any

    render(
      <Bubble
        currentUserUid="user-1"
        onQuoteSelection={handleQuote}
        message={{
          id: 'msg-approval',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          richParts: [
            {
              type: 'approval_card',
              title: 'Publish Hunt and Gun document',
              decisions: [
                { label: 'Approve publish/share with client', required: true },
                'Keep as internal draft for edits',
              ],
              replyTemplate: 'Approved: publish the Hunt and Gun document and give me the client share link.',
            },
          ],
        }}
      />,
    )

    const approveRadio = screen.getByRole('radio', { name: /Approve publish\/share with client \(required\)/i })
    const draftRadio = screen.getByRole('radio', { name: /Keep as internal draft for edits/i })

    expect(approveRadio).not.toBeChecked()
    expect(draftRadio).not.toBeChecked()

    fireEvent.click(draftRadio)

    expect(draftRadio).toBeChecked()
    expect(approveRadio).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: /Add selected decision to chat/i }))
    expect(handleQuote).toHaveBeenCalledWith('Keep as internal draft for edits')

    fireEvent.click(screen.getByRole('button', { name: /Add reply to chat/i }))
    expect(handleQuote).toHaveBeenCalledWith('Approved: publish the Hunt and Gun document and give me the client share link.')
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
