/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import SourceNode from '@/components/creative-canvas/nodes/SourceNode'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'

function renderNode(data: CanvasNodeData) {
  return render(
    <ReactFlowProvider>
      <SourceNode
        id="n1"
        type="source"
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
        height={160}
      />
    </ReactFlowProvider>,
  )
}

test('renders the trim chip when the canvas node has a trim window', () => {
  const canvasNode = {
    id: 'seg-1',
    type: 'source',
    data: {
      segmentOf: 'video-1',
      trim: { startSeconds: 2.5, endSeconds: 6.5 },
    },
  } as unknown as CreativeCanvasNode

  renderNode({
    presentationType: 'source',
    title: 'Segment',
    canvasNode,
  })

  const chip = screen.getByLabelText('Video segment 2.5s to 6.5s')
  expect(chip).toBeInTheDocument()
  expect(chip).toHaveTextContent('✂ 2.5s–6.5s')
  expect(chip).toHaveAttribute('data-tip', 'Only this clip is processed by edits')
})

test('omits the trim chip when there is no trim window', () => {
  renderNode({
    presentationType: 'source',
    title: 'Source',
  })
  expect(screen.queryByLabelText(/Video segment/i)).not.toBeInTheDocument()
})
