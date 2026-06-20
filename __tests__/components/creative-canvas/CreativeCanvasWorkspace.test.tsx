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
    if (url.includes('/exports/draft') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { exportId: 'export-1', draft: { target: 'campaign_asset', status: 'internal_draft' } },
        }),
      }
    }
    if (url.includes('/creative-canvas/sources')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sources: [{
              id: 'upload:upload-1',
              title: 'Product bottle.png',
              description: 'Upload / image/png',
              source: {
                kind: 'upload',
                refId: 'upload-1',
                url: 'https://cdn.example.com/product.png',
                thumbnailUrl: 'https://cdn.example.com/product-thumb.png',
                storagePath: 'uploads/org-1/product.png',
                mimeType: 'image/png',
                altText: 'Product bottle.png',
                referenceRole: 'product',
                weight: 1,
              },
            }],
          },
        }),
      }
    }
    if (url.endsWith('/runs?orgId=org-1') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { run: { id: 'run-1', status: 'queued', nodeId: 'model-node-1' } },
        }),
      }
    }
    if (url.includes('/runs/run-1/complete') && init?.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { run: { id: 'run-1', status: 'completed' }, outputNode: { id: 'output-1' } },
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

  it('imports a source library item into the canvas graph', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    expect(await screen.findByText('Product bottle.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /import product bottle.png/i }))

    expect(await screen.findByAltText('Reference preview: Product bottle.png')).toHaveAttribute(
      'src',
      'https://cdn.example.com/product-thumb.png',
    )
    expect(screen.getByText('product / 1')).toBeInTheDocument()
  })

  it('adds an edit node with mask and inpainting controls', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add edit node/i }))

    expect(await screen.findByText(/edit node/i)).toBeInTheDocument()
    expect(screen.getByText('Edit controls')).toBeInTheDocument()
    expect(screen.getAllByText('inpaint / image')[0]).toBeInTheDocument()
    expect(screen.getByText('Mask: not attached')).toBeInTheDocument()
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

  it('prepares a generic draft export from an output node', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add output node/i }))
    fireEvent.click(screen.getByRole('button', { name: /prepare draft export/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
    const exportCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/exports/draft'))
    expect(JSON.parse(exportCall?.[1]?.body as string)).toMatchObject({
      nodeId: expect.stringMatching(/^output-node-/),
      target: 'campaign_asset',
    })
  })

  it('queues a run and ingests the completed output', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add model node/i }))
    fireEvent.click(screen.getByRole('button', { name: /queue run/i }))

    expect(await screen.findByText(/run queued: run-1/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /ingest run output/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/runs/run-1/complete?orgId=org-1', expect.objectContaining({
        method: 'PUT',
      }))
    })
  })

  it('queues Higgsfield runs with selected generation settings', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add model node/i }))
    fireEvent.change(screen.getByLabelText(/output kind/i), { target: { value: 'video' } })
    fireEvent.change(screen.getByLabelText(/aspect ratio/i), { target: { value: '9:16' } })
    fireEvent.change(screen.getByLabelText(/duration seconds/i), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(/variants/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/style preset/i), { target: { value: 'cinematic_product' } })
    fireEvent.change(screen.getByLabelText(/camera motion/i), { target: { value: 'camera_push' } })
    fireEvent.change(screen.getByLabelText(/negative prompt/i), { target: { value: 'blurry, distorted hands' } })
    fireEvent.click(screen.getByRole('button', { name: /queue run/i }))

    await screen.findByText(/run queued: run-1/i)
    const runCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith('/runs?orgId=org-1') && init?.method === 'POST'
    )
    expect(JSON.parse(runCall?.[1]?.body as string)).toMatchObject({
      providerKey: 'higgsfield',
      input: {
        outputKind: 'video',
        aspectRatio: '9:16',
        durationSeconds: 6,
        variantCount: 3,
        stylePreset: 'cinematic_product',
        cameraMotion: 'camera_push',
        negativePrompt: 'blurry, distorted hands',
      },
    })
  })

  it('renders visual reference previews for source nodes', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/versions')) {
        return { ok: true, json: async () => ({ success: true, data: { versions: [] } }) }
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            canvases: [{
              id: 'canvas-1',
              orgId: 'org-1',
              title: 'Reference Canvas',
              purpose: 'Product reference',
              status: 'draft',
              activeVersion: 1,
              nodes: [{
                id: 'source-1',
                orgId: 'org-1',
                type: 'source',
                title: 'Product bottle',
                position: { x: 0, y: 0 },
                data: {},
                source: {
                  kind: 'upload',
                  thumbnailUrl: 'https://cdn.example.com/product-thumb.png',
                  previewUrl: 'https://cdn.example.com/product.png',
                  altText: 'Red product bottle',
                  referenceRole: 'product',
                  weight: 0.8,
                },
              }],
              edges: [],
            }],
          },
        }),
      }
    })

    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    expect(await screen.findByAltText('Reference preview: Red product bottle')).toHaveAttribute(
      'src',
      'https://cdn.example.com/product-thumb.png',
    )
    expect(screen.getByText('product / 0.8')).toBeInTheDocument()
  })
})
