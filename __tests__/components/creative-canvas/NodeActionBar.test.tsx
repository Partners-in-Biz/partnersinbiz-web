/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import NodeActionBar, { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

describe('NodeActionBar', () => {
  it('fires each action handler', () => {
    const onDelete = jest.fn()
    const onDuplicate = jest.fn()
    const onEditWithAi = jest.fn()
    const onReplaceContent = jest.fn()
    render(
      <NodeActionBar
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onEditWithAi={onEditWithAi}
        onReplaceContent={onReplaceContent}
        downloadUrl="https://example.com/asset.png"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /delete node/i }))
    fireEvent.click(screen.getByRole('button', { name: /duplicate node/i }))
    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))
    fireEvent.click(screen.getByRole('button', { name: /replace content/i }))
    expect(onDelete).toHaveBeenCalled()
    expect(onDuplicate).toHaveBeenCalled()
    expect(onEditWithAi).toHaveBeenCalled()
    expect(onReplaceContent).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /open media/i })).toHaveAttribute('href', 'https://example.com/asset.png')
  })

  it('renders nothing without handlers', () => {
    const { container } = render(<NodeActionBar />)
    expect(container.firstChild).toBeNull()
  })

  it('nodeActionsFor builds the bar from node data', () => {
    const data = { presentationType: 'source', title: 'Person', onDelete: jest.fn() } as unknown as CanvasNodeData
    render(<>{nodeActionsFor(data)}</>)
    expect(screen.getByRole('button', { name: /delete node/i })).toBeInTheDocument()
  })
})
