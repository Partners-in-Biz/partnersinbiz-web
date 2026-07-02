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

test('Book group offers Character and Chapter nodes', () => {
  const onCreate = jest.fn()
  render(<CreateMenu position={{ x: 10, y: 10 }} onCreate={onCreate} onClose={() => {}} />)
  fireEvent.click(screen.getByText('Character'))
  expect(onCreate).toHaveBeenCalledWith('character', undefined)
  fireEvent.click(screen.getByText('Chapter'))
  expect(onCreate).toHaveBeenCalledWith('chapter', undefined)
})

test('Planning group offers Screen node', () => {
  const onCreate = jest.fn()
  render(<CreateMenu position={{ x: 10, y: 10 }} onCreate={onCreate} onClose={() => {}} />)
  fireEvent.click(screen.getByText('Screen'))
  expect(onCreate).toHaveBeenCalledWith('screen', undefined)
})
