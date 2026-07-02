import { render, screen, fireEvent } from '@testing-library/react'
import CanvasLanding from '@/components/creative-canvas/landing/CanvasLanding'

const boards = [{ id: 'b1', title: 'My First Board', updatedLabel: 'Edited 2h ago' }]
const templates = [{ id: 't1', title: 'Product Photoshoot', description: 'Studio-grade shots' }]

test('All Canvases tab: tabs render, create control fires, board card opens', () => {
  const onCreate = jest.fn()
  const onOpenBoard = jest.fn()
  render(
    <CanvasLanding
      boards={boards}
      templates={templates}
      onCreate={onCreate}
      onOpenBoard={onOpenBoard}
      onUseTemplate={jest.fn()}
    />
  )

  expect(screen.getByRole('button', { name: 'All Canvases' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Templates' })).toBeInTheDocument()

  fireEvent.click(screen.getByText('Create Canvas'))
  expect(onCreate).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByText('My First Board'))
  expect(onOpenBoard).toHaveBeenCalledWith('b1')
})

test('Templates tab: clicking tab shows template, clicking it uses template', () => {
  const onUseTemplate = jest.fn()
  render(
    <CanvasLanding
      boards={boards}
      templates={templates}
      onCreate={jest.fn()}
      onOpenBoard={jest.fn()}
      onUseTemplate={onUseTemplate}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
  expect(screen.getByText('Product Photoshoot')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Product Photoshoot'))
  expect(onUseTemplate).toHaveBeenCalledWith('t1')
})

test('board rename action commits a new title', () => {
  const onRenameBoard = jest.fn()
  render(
    <CanvasLanding
      boards={boards}
      templates={templates}
      onCreate={jest.fn()}
      onOpenBoard={jest.fn()}
      onUseTemplate={jest.fn()}
      onRenameBoard={onRenameBoard}
      onDeleteBoard={jest.fn()}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: /rename canvas my first board/i }))
  const input = screen.getByLabelText(/rename my first board/i)
  fireEvent.change(input, { target: { value: 'Renamed Board' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onRenameBoard).toHaveBeenCalledWith('b1', 'Renamed Board')
})

test('board delete action asks for confirmation first', () => {
  const onDeleteBoard = jest.fn()
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  render(
    <CanvasLanding
      boards={boards}
      templates={templates}
      onCreate={jest.fn()}
      onOpenBoard={jest.fn()}
      onUseTemplate={jest.fn()}
      onRenameBoard={jest.fn()}
      onDeleteBoard={onDeleteBoard}
    />
  )

  const deleteButton = screen.getByRole('button', { name: /delete canvas my first board/i })
  fireEvent.click(deleteButton)
  expect(onDeleteBoard).not.toHaveBeenCalled()
  fireEvent.click(deleteButton)
  expect(onDeleteBoard).toHaveBeenCalledWith('b1')
  confirmSpy.mockRestore()
})
