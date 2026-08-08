import { render, screen } from '@testing-library/react'

import { DesignIterationCard } from '@/components/chat/DesignIterationCard'
import type { RichMessagePart } from '@/lib/hermes/types'

function part(overrides: Partial<RichMessagePart> = {}): RichMessagePart {
  return {
    type: 'design_iteration',
    id: 'design-iteration:di_1',
    title: 'Design this page — https://example.com/',
    statusLabel: '2 variants · 2 pending',
    body: 'URL: https://example.com/\nInstruction: make the hero bolder, keep sharp corners\nElement refs: @e12 Hero heading',
    evidence: ['2 archetype-distinct variants'],
    images: [{ url: 'https://cdn.example/baseline.jpg', alt: 'Live page — design this page baseline', caption: 'Baseline page' }],
    metrics: [
      { label: 'Variants', value: 2 },
      { label: 'Pending', value: 2 },
      { label: 'Accepted', value: 0 },
      { label: 'Rejected', value: 0 },
    ],
    sections: [
      { heading: 'Variant 1 — Bolder hero [pending]', items: ['Bolder hero — pending (DOM/CSS edit): Larger display scale.', 'Preview: https://cdn.example/v1.jpg'] },
      { heading: 'Variant 2 — Sharp corners [pending]', items: ['Sharp corners — pending (DOM/CSS edit): Zero-radius cards.'] },
    ],
    ...overrides,
  }
}

describe('DesignIterationCard', () => {
  it('renders the variant deck with baseline screenshot, instruction, and variant sections', () => {
    render(<DesignIterationCard part={part()} />)
    expect(screen.getByTestId('design-iteration-card')).toBeInTheDocument()
    expect(screen.getByText('Design this page — https://example.com/')).toBeInTheDocument()
    expect(screen.getByTestId('design-iteration-status')).toHaveTextContent('2 variants · 2 pending')
    expect(screen.getByText(/make the hero bolder, keep sharp corners/)).toBeInTheDocument()
    expect(screen.getByText(/@e12 Hero heading/)).toBeInTheDocument()
    expect(screen.getByTestId('design-iteration-screenshot')).toHaveAttribute('href', 'https://cdn.example/baseline.jpg')
    expect(screen.getByText(/Variant 1 — Bolder hero/)).toBeInTheDocument()
    expect(screen.getByText(/Variant 2 — Sharp corners/)).toBeInTheDocument()
  })

  it('shows an applied badge and repo evidence when applied', () => {
    render(<DesignIterationCard part={part({
      statusLabel: 'Applied',
      evidence: ['Applied to partnersinbiz-web-development (development)', 'Diff: +12 -3 hero block'],
    })} />)
    expect(screen.getByTestId('design-iteration-status')).toHaveTextContent('Applied')
    expect(screen.getByText(/Applied to partnersinbiz-web-development/)).toBeInTheDocument()
  })
})
