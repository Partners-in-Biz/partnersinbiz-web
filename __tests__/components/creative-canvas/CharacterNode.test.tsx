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
