/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import VideoSplitDialog from '@/components/creative-canvas/panels/VideoSplitDialog'

describe('VideoSplitDialog', () => {
  const baseProps = {
    open: true,
    videoUrl: 'https://cdn.example.com/demo.mp4',
    nodeTitle: 'Demo clip',
    onClose: jest.fn(),
    onSplit: jest.fn(),
  }

  beforeEach(() => jest.clearAllMocks())

  it('renders nothing when closed', () => {
    const { container } = render(<VideoSplitDialog {...baseProps} open={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('rejects segments whose end is not after start', () => {
    render(<VideoSplitDialog {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /\+ add segment/i }))
    expect(screen.getByText(/end must be after start/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create\s+segment node/i })).toBeDisabled()
  })

  it('collects segments and passes them to onSplit', () => {
    render(<VideoSplitDialog {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/start \(s\)/i), { target: { value: '2.5' } })
    fireEvent.change(screen.getByLabelText(/end \(s\)/i), { target: { value: '6.5' } })
    fireEvent.click(screen.getByRole('button', { name: /\+ add segment/i }))
    expect(screen.getByText(/segment 1:/i)).toBeInTheDocument()

    // Second segment starts where the first ended.
    fireEvent.change(screen.getByLabelText(/end \(s\)/i), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: /\+ add segment/i }))

    fireEvent.click(screen.getByRole('button', { name: /create 2 segment nodes/i }))
    expect(baseProps.onSplit).toHaveBeenCalledWith([
      { startSeconds: 2.5, endSeconds: 6.5 },
      { startSeconds: 6.5, endSeconds: 10 },
    ])
  })

  it('closes via the close button', () => {
    render(<VideoSplitDialog {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /close split dialog/i }))
    expect(baseProps.onClose).toHaveBeenCalled()
  })
})
