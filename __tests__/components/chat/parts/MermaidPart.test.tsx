import { render, screen, waitFor } from '@testing-library/react'
import { MermaidPart } from '@/components/chat/parts/MermaidPart'

const renderMock = jest.fn()

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    render: (...args: unknown[]) => renderMock(...args),
  },
}))

describe('MermaidPart', () => {
  beforeEach(() => {
    renderMock.mockReset()
  })

  it('renders sanitized SVG from mermaid.render', async () => {
    renderMock.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Client request</text></svg>',
    })
    render(<MermaidPart part={{ type: 'mermaid', source: 'graph TD; A-->B;', title: 'Flow' }} />)
    expect(await screen.findByTestId('mermaid-part')).toBeInTheDocument()
    expect(await screen.findByText('Client request')).toBeInTheDocument()
    expect(screen.getByText('Flow')).toBeInTheDocument()
    expect(renderMock).toHaveBeenCalled()
  })

  it('shows the source as a code block when mermaid.render fails', async () => {
    renderMock.mockRejectedValue(new Error('Parse error on line 1'))
    render(<MermaidPart part={{ type: 'mermaid', source: 'not a diagram' }} />)
    await waitFor(() => {
      expect(screen.getByText('Parse error on line 1')).toBeInTheDocument()
    })
    expect(screen.getByText('not a diagram')).toBeInTheDocument()
  })
})
