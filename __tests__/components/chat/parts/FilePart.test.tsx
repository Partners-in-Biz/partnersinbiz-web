import { render, screen } from '@testing-library/react'
import { FilePart } from '@/components/chat/parts/FilePart'

describe('FilePart', () => {
  it('embeds an allowed PDF in a sandboxed iframe and keeps a download row', () => {
    const { container } = render(
      <FilePart
        part={{
          type: 'file',
          url: 'https://cdn.example.com/brief.pdf',
          name: 'Launch brief.pdf',
          contentType: 'application/pdf',
          size: 2048,
        }}
      />,
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe?.getAttribute('src')).toContain('https://cdn.example.com/brief.pdf')
    expect(screen.getByRole('link', { name: /Launch brief\.pdf/i })).toHaveAttribute(
      'href',
      'https://cdn.example.com/brief.pdf',
    )
  })

  it('refuses a javascript: URL', () => {
    const { container } = render(
      <FilePart
        part={{
          type: 'file',
          url: 'javascript:alert(1)',
          name: 'evil.pdf',
          contentType: 'application/pdf',
        }}
      />,
    )
    expect(container.querySelector('iframe')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Unsupported content')).toBeInTheDocument()
  })

  it('refuses a data: URL', () => {
    render(
      <FilePart
        part={{
          type: 'file',
          url: 'data:text/html,<script>alert(1)</script>',
          name: 'page.html',
          contentType: 'text/html',
        }}
      />,
    )
    expect(screen.getByText('Unsupported content')).toBeInTheDocument()
  })
})
