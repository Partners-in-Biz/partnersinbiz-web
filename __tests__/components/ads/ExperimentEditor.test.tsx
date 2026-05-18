/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ExperimentEditor } from '@/components/ads/ExperimentEditor'

// Mock next/link
jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
  Link.displayName = 'Link'
  return Link
})

// Mock fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

describe('ExperimentEditor', () => {
  it('renders form with default variants A and B', () => {
    render(
      <ExperimentEditor orgSlug="acme" onSaved={jest.fn()} />,
    )
    // Variant ids are rendered as lowercase in the spans
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    // Should not show c or d initially
    expect(screen.queryByText('c')).not.toBeInTheDocument()
    expect(screen.queryByText('d')).not.toBeInTheDocument()
  })

  it('Add variant button appends C variant (up to 4)', () => {
    render(
      <ExperimentEditor orgSlug="acme" onSaved={jest.fn()} />,
    )
    const addBtn = screen.getByRole('button', { name: /Add variant/i })
    fireEvent.click(addBtn)
    expect(screen.getByText('c')).toBeInTheDocument()

    // Add one more → d
    fireEvent.click(screen.getByRole('button', { name: /Add variant/i }))
    expect(screen.getByText('d')).toBeInTheDocument()

    // No more add button when at 4
    expect(screen.queryByRole('button', { name: /Add variant/i })).not.toBeInTheDocument()
  })

  it('validates traffic percents sum to 100 on submit', async () => {
    render(
      <ExperimentEditor orgSlug="acme" onSaved={jest.fn()} />,
    )
    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. CTA button/i), {
      target: { value: 'My Experiment' },
    })
    fireEvent.change(screen.getByPlaceholderText(/cmp_xxx/i), {
      target: { value: 'cmp_123' },
    })
    fireEvent.change(screen.getByPlaceholderText(/adset_xxx/i), {
      target: { value: 'adset_456' },
    })

    // Change variant A traffic to 30 (B stays at 50 → total 80, not 100)
    const trafficInputs = screen.getAllByDisplayValue('50')
    fireEvent.change(trafficInputs[0], { target: { value: '30' } })

    fireEvent.click(screen.getByRole('button', { name: /Create experiment/i }))

    await waitFor(() => {
      expect(screen.getByText(/Traffic percents must sum to 100/i)).toBeInTheDocument()
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('validates duplicate variant ids are rejected', async () => {
    // Render with initial data that has duplicate ids
    render(
      <ExperimentEditor
        orgSlug="acme"
        onSaved={jest.fn()}
        initial={{
          name: 'Test',
          level: 'adset',
          platform: 'meta',
          parentEntityId: 'cmp_x',
          sourceEntityId: 'adset_x',
          successMetric: 'ctr',
          variants: [
            { id: 'a', name: 'A', trafficPercent: 50 },
            { id: 'a', name: 'A-dup', trafficPercent: 50 },
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Create experiment/i }))

    await waitFor(() => {
      expect(screen.getByText(/Variant IDs must be unique/i)).toBeInTheDocument()
    })
  })

  it('POSTs in create mode on valid submit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 'exp_new',
          name: 'My Experiment',
          status: 'draft',
          variants: [],
        },
      }),
    })

    const onSaved = jest.fn()
    render(<ExperimentEditor orgSlug="acme" onSaved={onSaved} />)

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. CTA button/i), {
      target: { value: 'My Experiment' },
    })
    fireEvent.change(screen.getByPlaceholderText(/cmp_xxx/i), {
      target: { value: 'cmp_123' },
    })
    fireEvent.change(screen.getByPlaceholderText(/adset_xxx/i), {
      target: { value: 'adset_456' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Create experiment/i }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/ads/experiments',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('PATCHes when experimentId is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 'exp_abc',
          name: 'Updated Name',
          status: 'draft',
          variants: [],
        },
      }),
    })

    const onSaved = jest.fn()
    render(
      <ExperimentEditor
        orgSlug="acme"
        experimentId="exp_abc"
        initial={{
          name: 'Original Name',
          level: 'adset',
          platform: 'meta',
          parentEntityId: 'cmp_x',
          sourceEntityId: 'adset_x',
          successMetric: 'ctr',
          variants: [
            { id: 'a', name: 'A', trafficPercent: 50 },
            { id: 'b', name: 'B', trafficPercent: 50 },
          ],
        }}
        onSaved={onSaved}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/ads/experiments/exp_abc',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
    expect(onSaved).toHaveBeenCalled()
  })
})
