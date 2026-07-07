import { render, screen, fireEvent } from '@testing-library/react'
import CanvasLanding from '@/components/creative-canvas/landing/CanvasLanding'
import { starterCanvasTemplates } from '@/lib/creative-canvas/starter-templates'

const boards = [{
  id: 'b1',
  title: 'My First Board',
  purpose: 'Launch campaign ideas',
  updatedLabel: 'Edited 2h ago',
  nodes: [
    {
      id: 'n1',
      orgId: 'org-1',
      type: 'brief',
      title: 'Campaign brief',
      position: { x: 0, y: 0 },
      data: {},
    },
    {
      id: 'n2',
      orgId: 'org-1',
      type: 'output',
      title: 'Hero visual',
      position: { x: 280, y: 160 },
      data: {},
    },
  ],
  edges: [{
    id: 'e1',
    orgId: 'org-1',
    sourceNodeId: 'n1',
    targetNodeId: 'n2',
  }],
}]
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

test('All Canvases tab: board cards show a graph preview and node summary', () => {
  render(
    <CanvasLanding
      boards={boards}
      templates={templates}
      onCreate={jest.fn()}
      onOpenBoard={jest.fn()}
      onUseTemplate={jest.fn()}
    />
  )

  expect(screen.getByLabelText('2 node canvas preview')).toBeInTheDocument()
  expect(screen.getByText('Launch campaign ideas')).toBeInTheDocument()
  expect(screen.getByText(/2 nodes .* 1 links/)).toBeInTheDocument()
  expect(screen.getByText('Brief')).toBeInTheDocument()
  expect(screen.getByText('Output')).toBeInTheDocument()
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

test('Templates tab: starter templates render above saved templates and are clickable', () => {
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

  expect(screen.getByText('Starter templates')).toBeInTheDocument()
  expect(screen.getByText('Your templates')).toBeInTheDocument()

  // Every starter template renders a card with a "Starter" badge.
  for (const starter of starterCanvasTemplates) {
    expect(screen.getByText(starter.title)).toBeInTheDocument()
  }
  const starterBadges = screen.getAllByText('Starter')
  expect(starterBadges.length).toBe(starterCanvasTemplates.length)

  const firstStarter = starterCanvasTemplates[0]
  fireEvent.click(screen.getByText(firstStarter.title))
  expect(onUseTemplate).toHaveBeenCalledWith(firstStarter.id)
})

test('Templates tab: starter templates still render when there are no saved templates', () => {
  render(
    <CanvasLanding
      boards={boards}
      templates={[]}
      onCreate={jest.fn()}
      onOpenBoard={jest.fn()}
      onUseTemplate={jest.fn()}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: 'Templates' }))

  expect(screen.getByText('Starter templates')).toBeInTheDocument()
  expect(screen.queryByText('Your templates')).not.toBeInTheDocument()
  expect(screen.getByText(starterCanvasTemplates[0].title)).toBeInTheDocument()
})
