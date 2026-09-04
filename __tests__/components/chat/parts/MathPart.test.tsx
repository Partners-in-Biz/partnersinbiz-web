import { render, screen, waitFor } from '@testing-library/react'
import { MathPart } from '@/components/chat/parts/MathPart'

const renderToString = jest.fn()

jest.mock('katex', () => ({
  __esModule: true,
  default: {
    renderToString: (...args: unknown[]) => renderToString(...args),
  },
}))

describe('MathPart', () => {
  beforeEach(() => {
    renderToString.mockReset()
  })

  it('renders katex HTML for valid latex', async () => {
    renderToString.mockReturnValue('<span class="katex">E=mc^2</span>')
    render(<MathPart part={{ type: 'math', latex: 'E=mc^2', display: true }} />)
    expect(await screen.findByText('E=mc^2')).toBeInTheDocument()
    expect(screen.getByTestId('math-part')).toBeInTheDocument()
    expect(renderToString).toHaveBeenCalledWith('E=mc^2', {
      displayMode: true,
      throwOnError: false,
      output: 'html',
    })
  })

  it('surfaces a render failure', async () => {
    renderToString.mockImplementation(() => {
      throw new Error('KaTeX boom')
    })
    render(<MathPart part={{ type: 'math', latex: '\\bad' }} />)
    await waitFor(() => {
      expect(screen.getByText('KaTeX boom')).toBeInTheDocument()
    })
  })
})
