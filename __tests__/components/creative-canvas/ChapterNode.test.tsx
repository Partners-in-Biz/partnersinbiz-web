import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import ChapterNode from '@/components/creative-canvas/nodes/ChapterNode'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

function renderNode(data: CanvasNodeData) {
  return render(
    <ReactFlowProvider>
      <ChapterNode
        id="n1"
        type="chapter"
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
    presentationType: 'chapter',
    title: 'Chapter One',
    text: 'It was a dark and stormy night',
    onTextChange,
  })
  expect(screen.getByText('Chapter One')).toBeInTheDocument()
  const textarea = screen.getByPlaceholderText('Write the chapter…')
  expect(textarea).toHaveValue('It was a dark and stormy night')
  fireEvent.change(textarea, { target: { value: 'The sun rose over the hills' } })
  expect(onTextChange).toHaveBeenCalledWith('The sun rose over the hills')
})

test('falls back to default title and shows the action bar when handlers exist', () => {
  const onDelete = jest.fn()
  renderNode({
    presentationType: 'chapter',
    title: '',
    onDelete,
    onDuplicate: () => {},
  })
  expect(screen.getByText('Chapter')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /duplicate node/i })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /delete node/i }))
  expect(onDelete).toHaveBeenCalled()
})
