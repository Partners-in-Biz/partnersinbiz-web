/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CreativePicker } from '@/components/ads/CreativePicker'

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch
})

describe('CreativePicker', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <CreativePicker open={false} orgId="org_1" onSelect={() => {}} onClose={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('fetches and lists creatives when opened', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          { id: 'crv_a', name: 'Hero', type: 'image', width: 1200, height: 1200, previewUrl: 'https://x/p.jpg' },
          { id: 'crv_b', name: 'Banner', type: 'image', width: 1500, height: 500 },
        ],
      }),
    })
    render(<CreativePicker open orgId="org_1" onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Hero')).toBeInTheDocument())
    expect(screen.getByText('Banner')).toBeInTheDocument()
    const libraryTab = screen.getByRole('tab', { name: /Library\s*2/ })
    expect(libraryTab).toHaveAttribute('aria-selected', 'true')
    expect(within(libraryTab).getByText('2')).toBeInTheDocument()
  })

  it('single mode replaces selection on click', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          { id: 'crv_a', name: 'A', type: 'image' },
          { id: 'crv_b', name: 'B', type: 'image' },
        ],
      }),
    })
    const onSelect = jest.fn()
    render(<CreativePicker open orgId="org_1" mode="single" onSelect={onSelect} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    fireEvent.click(screen.getByText('A').closest('button')!)
    fireEvent.click(screen.getByText('B').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: /Use this/i }))
    expect(onSelect).toHaveBeenCalledWith(['crv_b'])
  })

  it('multi mode toggles multiple selections', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          { id: 'crv_a', name: 'A', type: 'image' },
          { id: 'crv_b', name: 'B', type: 'image' },
        ],
      }),
    })
    const onSelect = jest.fn()
    render(<CreativePicker open orgId="org_1" mode="multi" onSelect={onSelect} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    fireEvent.click(screen.getByText('A').closest('button')!)
    fireEvent.click(screen.getByText('B').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: /Use these/i }))
    expect(onSelect).toHaveBeenCalledWith(['crv_a', 'crv_b'])
  })

  it('shows empty state when no creatives exist', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    })
    render(<CreativePicker open orgId="org_1" onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText(/No creatives yet/)).toBeInTheDocument(),
    )
  })
})
