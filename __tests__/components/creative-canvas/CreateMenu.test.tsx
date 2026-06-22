import { render, screen, fireEvent } from '@testing-library/react'
import CreateMenu from '@/components/creative-canvas/canvas/CreateMenu'

test('filters by search and creates on click', () => {
  const onCreate = jest.fn()
  render(<CreateMenu position={{ x: 10, y: 10 }} onCreate={onCreate} onClose={() => {}} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'vid' } })
  fireEvent.click(screen.getByText('Video Generator'))
  expect(onCreate).toHaveBeenCalledWith('video_generator', undefined)
})

test('typing "sticky" shows Sticky Note and creates on click', () => {
  const onCreate = jest.fn()
  render(<CreateMenu position={{ x: 10, y: 10 }} onCreate={onCreate} onClose={() => {}} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'sticky' } })
  fireEvent.click(screen.getByText('Sticky Note'))
  expect(onCreate).toHaveBeenCalledWith('sticky_note', undefined)
})
