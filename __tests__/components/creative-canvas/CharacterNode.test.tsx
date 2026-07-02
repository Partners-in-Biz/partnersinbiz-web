import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import CharacterNode from '@/components/creative-canvas/nodes/CharacterNode'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

function renderNode(data: CanvasNodeData) {
  return render(
    <ReactFlowProvider>
      <CharacterNode
        id="n1"
        type="character"
        data={data}
        selected={false}
        isConnectable
        dragging={false}
        zIndex={0}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        deletable
        selectable
        draggable
        width={240}
        height={140}
      />
    </ReactFlowProvider>,
  )
}

test('renders title and editable text that fires onTextChange', () => {
  const onTextChange = jest.fn()
  renderNode({
    presentationType: 'character',
    title: 'Hero',
    text: 'A brave knight',
    onTextChange,
  })
  expect(screen.getByText('Hero')).toBeInTheDocument()
  const textarea = screen.getByPlaceholderText('Describe the character…')
  expect(textarea).toHaveValue('A brave knight')
  fireEvent.change(textarea, { target: { value: 'A cunning rogue' } })
  expect(onTextChange).toHaveBeenCalledWith('A cunning rogue')
})

test('falls back to default title and shows the action bar when handlers exist', () => {
  const onDelete = jest.fn()
  renderNode({
    presentationType: 'character',
    title: '',
    onDelete,
    onDuplicate: () => {},
  })
  expect(screen.getByText('Character')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /duplicate node/i })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /delete node/i }))
  expect(onDelete).toHaveBeenCalled()
})

test('shows the reference image and hides the add-reference button when assetUrl is set', () => {
  renderNode({
    presentationType: 'character',
    title: 'Hero',
    assetUrl: 'https://example.com/hero.png',
  })
  const img = screen.getByRole('img', { name: 'Hero' })
  expect(img).toHaveAttribute('src', 'https://example.com/hero.png')
  expect(screen.queryByRole('button', { name: /add reference/i })).not.toBeInTheDocument()
})

test('shows the add-reference button when no assetUrl and fires onAddReference', () => {
  const onAddReference = jest.fn()
  renderNode({
    presentationType: 'character',
    title: 'Hero',
    onAddReference,
  })
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /add reference/i }))
  expect(onAddReference).toHaveBeenCalled()
})

test('shows the Soul badge with the id in its tooltip when soulId is set', () => {
  renderNode({
    presentationType: 'character',
    title: 'Hero',
    soulId: 'soul-abc123',
  })
  const badge = screen.getByText('Soul')
  expect(badge).toBeInTheDocument()
  expect(badge).toHaveAttribute('title', 'Soul ID: soul-abc123')
})

test('hides the Soul badge when soulId is missing or empty', () => {
  renderNode({ presentationType: 'character', title: 'Hero', soulId: '' })
  expect(screen.queryByText('Soul')).not.toBeInTheDocument()
})
