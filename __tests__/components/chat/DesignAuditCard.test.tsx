import { render, screen } from '@testing-library/react'
import { DesignAuditCard } from '@/components/chat/DesignAuditCard'
import type { RichMessagePart } from '@/lib/hermes/types'

function auditPart(overrides: Partial<RichMessagePart> = {}): RichMessagePart {
  return {
    type: 'design_audit',
    id: 'design-audit:dar_1',
    title: 'Design audit — https://example.com/',
    statusLabel: '2 findings',
    body: 'URL: https://example.com/\nScope: all · Engine exit code: 2',
    evidence: ['Rules run: 2 findings'],
    metrics: [
      { label: 'P0', value: 1 },
      { label: 'P1', value: 1 },
      { label: 'P2', value: 0 },
      { label: 'P3', value: 0 },
    ],
    images: [{ url: 'https://cdn.example/frame.jpg', alt: 'Live page screenshot' }],
    sections: [
      { heading: 'P0 — 1', items: ['purple-gradients @ section.hero — Purple gradient'] },
      { heading: 'P1 — 1', items: ['tiny-body-text (11px) @ p:nth-of-type(1):2 — Body text is too small'] },
    ],
    ...overrides,
  }
}

describe('DesignAuditCard', () => {
  it('renders the audit title, status, metrics, screenshot and grouped findings', () => {
    render(<DesignAuditCard part={auditPart()} />)

    expect(screen.getByTestId('design-audit-card')).toBeInTheDocument()
    expect(screen.getByText('Design audit — https://example.com/')).toBeInTheDocument()
    expect(screen.getByTestId('design-audit-status')).toHaveTextContent('2 findings')
    expect(screen.getByTestId('design-audit-screenshot')).toBeInTheDocument()
    expect(screen.getByTestId('design-audit-section-P0 — 1')).toBeInTheDocument()
    expect(screen.getByTestId('design-audit-section-P1 — 1')).toBeInTheDocument()
    expect(screen.getByText(/purple-gradients @ section.hero/)).toBeInTheDocument()
  })

  it('shows the clean empty state', () => {
    render(<DesignAuditCard part={auditPart({ statusLabel: 'Clean', metrics: [], sections: [], body: '' })} />)
    expect(screen.getByText(/No failing findings/)).toBeInTheDocument()
  })

  it('surfaces the failure state', () => {
    render(<DesignAuditCard part={auditPart({ statusLabel: 'Audit failed', sections: [] })} />)
    expect(screen.getByTestId('design-audit-status')).toHaveTextContent('Audit failed')
  })
})
