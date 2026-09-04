import { fireEvent, render, screen } from '@testing-library/react'
import { HtmlArtifactPart } from '@/components/chat/parts/HtmlArtifactPart'

describe('HtmlArtifactPart', () => {
  it('renders a sandboxed iframe with CSP in srcDoc', () => {
    const { container } = render(
      <HtmlArtifactPart
        part={{ type: 'html_artifact', title: 'Card', html: '<p>Hello artifact</p>', height: 240 }}
      />,
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
    const srcDoc = iframe?.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Hello artifact')
    expect(srcDoc).toContain('http-equiv="Content-Security-Policy"')
    expect(srcDoc).toContain("default-src 'none'")
    expect(srcDoc).toContain("style-src 'unsafe-inline'")
    expect(screen.getByText('Card')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in canvas' })).not.toBeInTheDocument()
  })

  it('shows Open in canvas above 480 and skips it for invalid empty html chrome still present', () => {
    const onOpenArtifact = jest.fn()
    render(
      <HtmlArtifactPart
        part={{ type: 'html_artifact', title: 'Tall card', html: '<p>Tall</p>', height: 640 }}
        onOpenArtifact={onOpenArtifact}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open in canvas' }))
    expect(onOpenArtifact).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tall card', height: 640 }))
  })
})
