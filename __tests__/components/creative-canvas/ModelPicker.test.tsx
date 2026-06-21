import { render, screen, fireEvent } from '@testing-library/react'
import ModelPicker from '@/components/creative-canvas/panels/ModelPicker'

describe('ModelPicker', () => {
  test('renders Featured and All headings and shows the Higgsfield catalog', () => {
    render(<ModelPicker kind="image" onSelect={() => {}} />)
    expect(screen.getByText('Featured models')).toBeInTheDocument()
    expect(screen.getByText('All models')).toBeInTheDocument()
    expect(screen.getAllByText('GPT Image 2').length).toBeGreaterThan(0)
  })

  test('searching "gpt" keeps GPT Image 2 and clicking calls onSelect', () => {
    const onSelect = jest.fn()
    render(<ModelPicker kind="image" onSelect={onSelect} />)

    const search = screen.getByPlaceholderText(/search/i)
    fireEvent.change(search, { target: { value: 'gpt' } })

    const rows = screen.getAllByText('GPT Image 2')
    expect(rows.length).toBeGreaterThan(0)

    fireEvent.click(rows[0])
    expect(onSelect).toHaveBeenCalledWith('gpt_image_2')
  })

  test('searching "zzzzz" hides GPT Image 2', () => {
    render(<ModelPicker kind="image" onSelect={() => {}} />)

    const search = screen.getByPlaceholderText(/search/i)
    fireEvent.change(search, { target: { value: 'zzzzz' } })

    expect(screen.queryByText('GPT Image 2')).not.toBeInTheDocument()
  })
})
