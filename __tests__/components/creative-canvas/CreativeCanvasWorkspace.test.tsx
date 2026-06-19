import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreativeCanvasWorkspace } from '@/components/creative-canvas/CreativeCanvasWorkspace'

jest.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, children }: { nodes: Array<{ id: string }>; children: React.ReactNode }) => (
    <div data-testid="react-flow">
      {nodes.map((node) => <div key={node.id}>{node.id}</div>)}
      {children}
    </div>
  ),
  Background: () => <div data-testid="flow-background" />,
  Controls: () => <div data-testid="flow-controls" />,
  MiniMap: () => <div data-testid="flow-minimap" />,
  addEdge: jest.fn((edge, edges) => edges.concat(edge)),
  useEdgesState: jest.fn((initial) => [initial, jest.fn(), jest.fn()]),
  useNodesState: jest.fn((initial) => [initial, jest.fn(), jest.fn()]),
}))

const fetchMock = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/versions')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { versions: [{ id: 'v2', version: 2, reason: 'graph_save' }] },
        }),
      }
    }
    if (url.includes('/comments') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { comment: { id: 'comment-1', body: 'Needs a stronger hook' } },
        }),
      }
    }

    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          canvases: [{
            id: 'canvas-1',
            orgId: 'org-1',
            title: 'Launch Canvas',
            purpose: 'Product launch',
            status: 'draft',
            activeVersion: 1,
            nodes: [],
            edges: [],
          }],
        },
      }),
    }
  })
})

describe('CreativeCanvasWorkspace', () => {
  it('renders the canvas workbench with palette, graph, and inspector', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    expect(await screen.findByText('Launch Canvas')).toBeInTheDocument()
    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Prompt')).toBeInTheDocument()
    expect(screen.getByText('Run history')).toBeInTheDocument()
    expect(screen.getByText('Versions')).toBeInTheDocument()
    expect(screen.getByText('Comments')).toBeInTheDocument()
    expect(screen.getByText('Output attachment')).toBeInTheDocument()
    expect(screen.getByText('Review gate')).toBeInTheDocument()
    expect(screen.getByText('Exports')).toBeInTheDocument()
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save graph/i })).toBeInTheDocument()
  })

  it('adds a source node from the palette', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add source node/i }))

    await waitFor(() => {
      expect(screen.getByText(/source node/i)).toBeInTheDocument()
    })
  })

  it('loads versions and posts comments for the active canvas', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    expect(await screen.findByText(/version 2/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/comment body/i), {
      target: { value: 'Needs a stronger hook' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/comments?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
  })
})
