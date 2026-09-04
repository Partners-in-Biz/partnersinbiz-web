import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserFramePart } from '@/components/chat/parts/BrowserFramePart'

describe('BrowserFramePart', () => {
  it('renders a screenshot, URL, and Take over action', () => {
    const onTakeOver = jest.fn()
    render(
      <BrowserFramePart
        part={{
          type: 'browser_frame',
          screenshotUrl: 'https://cdn.example.com/frame.png',
          url: 'https://example.com/app',
          sessionId: 'sess-1',
        }}
        onTakeOver={onTakeOver}
      />,
    )
    expect(screen.getByTestId('browser-frame-part')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'https://example.com/app' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/frame.png',
    )
    expect(screen.getByRole('link', { name: 'https://example.com/app' })).toHaveAttribute(
      'href',
      'https://example.com/app',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
    expect(onTakeOver).toHaveBeenCalledTimes(1)
  })

  it('rejects javascript: screenshot and page URLs', () => {
    render(
      <BrowserFramePart
        part={{
          type: 'browser_frame',
          screenshotUrl: 'javascript:alert(1)',
          url: 'javascript:alert(2)',
        }}
      />,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Unsupported content')).toBeInTheDocument()
  })
})
