/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { CanvasReviewPanel, type CanvasReviewPanelNode } from '@/components/creative-canvas/portal/CanvasReviewPanel'

const nodes: CanvasReviewPanelNode[] = [
  {
    id: 'node-image',
    title: 'Hero image',
    type: 'output',
    review: { status: 'needed' },
    output: { kind: 'image', url: 'https://cdn.example.com/hero.png' },
  },
  {
    id: 'node-text',
    title: 'Launch copy',
    type: 'brief',
    data: { text: 'Big launch, bigger savings.' },
  },
  {
    id: 'node-empty',
    title: 'Empty prompt node',
    type: 'prompt',
    data: {},
  },
]

function okResponse() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ success: true, data: { node: {} } }),
  } as Response)
}

describe('CanvasReviewPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(okResponse) as unknown as typeof fetch
  })

  it('renders a card per reviewable node and skips nodes without output or text', () => {
    render(<CanvasReviewPanel canvasId="canvas-1" orgId="org-1" nodes={nodes} />)

    expect(screen.getByText('Hero image')).toBeInTheDocument()
    expect(screen.getByText('Launch copy')).toBeInTheDocument()
    expect(screen.getByText('Big launch, bigger savings.')).toBeInTheDocument()
    expect(screen.queryByText('Empty prompt node')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(2)
  })

  it('approve fires PUT with action approve and flips the chip optimistically', async () => {
    const onReviewed = jest.fn()
    render(<CanvasReviewPanel canvasId="canvas-1" orgId="org-1" nodes={nodes} onReviewed={onReviewed} />)

    const card = screen.getByTestId('review-card-node-image')
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))

    expect(within(card).getByText('Approved')).toBeInTheDocument()
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith('node-image', 'approve'))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/creative-canvas/canvas-1/nodes/node-image/review?orgId=org-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ action: 'approve' }) }),
    )
  })

  it('request changes reveals a note textarea and sends the note', async () => {
    render(<CanvasReviewPanel canvasId="canvas-1" orgId="org-1" nodes={nodes} />)

    const card = screen.getByTestId('review-card-node-text')
    fireEvent.click(within(card).getByRole('button', { name: 'Request changes' }))

    const textarea = within(card).getByPlaceholderText('What should change?')
    fireEvent.change(textarea, { target: { value: 'Please soften the headline' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Send request' }))

    expect(within(card).getByText('Changes requested')).toBeInTheDocument()
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/creative-canvas/canvas-1/nodes/node-text/review?orgId=org-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ action: 'request_changes', note: 'Please soften the headline' }),
        }),
      ),
    )
  })

  it('shows an error and reverts the chip when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, error: 'This canvas is not shared for client review' }),
    } as Response) as unknown as typeof fetch

    render(<CanvasReviewPanel canvasId="canvas-1" orgId="org-1" nodes={nodes} />)

    const card = screen.getByTestId('review-card-node-image')
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(within(card).getByRole('alert')).toHaveTextContent('This canvas is not shared for client review'),
    )
    expect(within(card).getByText('Awaiting review')).toBeInTheDocument()
    expect(within(card).queryByText('Approved')).not.toBeInTheDocument()
  })
})
