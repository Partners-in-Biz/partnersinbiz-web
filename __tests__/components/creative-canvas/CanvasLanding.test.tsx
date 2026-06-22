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
