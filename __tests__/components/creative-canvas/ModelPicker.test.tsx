import { render, screen, fireEvent } from '@testing-library/react'
import ModelPicker from '@/components/creative-canvas/panels/ModelPicker'

describe('ModelPicker', () => {
  test('renders Featured and All headings and shows Grok Image', () => {
    render(<ModelPicker kind="image" onSelect={() => {}} />)
    expect(screen.getByText('Featured models')).toBeInTheDocument()
    expect(screen.getByText('All models')).toBeInTheDocument()
    expect(screen.getAllByText('Grok Image').length).toBeGreaterThan(0)
  })

  test('searching "grok" keeps Grok Image and clicking calls onSelect', () => {
    const onSelect = jest.fn()
    render(<ModelPicker kind="image" onSelect={onSelect} />)

    const search = screen.getByPlaceholderText(/search/i)
    fireEvent.change(search, { target: { value: 'grok' } })

    const rows = screen.getAllByText('Grok Image')
    expect(rows.length).toBeGreaterThan(0)

    fireEvent.click(rows[0])
    expect(onSelect).toHaveBeenCalledWith('grok-image')
  })

  test('searching "zzzzz" hides Grok Image', () => {
    render(<ModelPicker kind="image" onSelect={() => {}} />)

    const search = screen.getByPlaceholderText(/search/i)
    fireEvent.change(search, { target: { value: 'zzzzz' } })

    expect(screen.queryByText('Grok Image')).not.toBeInTheDocument()
  })
})
