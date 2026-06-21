import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import ImageGeneratorNode from '@/components/creative-canvas/nodes/ImageGeneratorNode'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

function renderNode(data: CanvasNodeData) {
  return render(
    <ReactFlowProvider>
      <ImageGeneratorNode
        id="n1"
        type="image_generator"
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
        width={260}
        height={200}
      />
    </ReactFlowProvider>,
  )
}

test('renders prompt, model label and a Generate button with credit cost', () => {
  const onGenerate = jest.fn()
  renderNode({
    presentationType: 'image_generator',
    title: 'Image Generation',
    model: 'Grok Image',
    prompt: '',
    creditCost: 7,
    onGenerate,
    onPromptChange: () => {},
  })
  expect(screen.getByText('Grok Image')).toBeInTheDocument()
  const btn = screen.getByRole('button', { name: /generate/i })
  expect(btn).toHaveTextContent('7')
  fireEvent.click(btn)
  expect(onGenerate).toHaveBeenCalled()
})
