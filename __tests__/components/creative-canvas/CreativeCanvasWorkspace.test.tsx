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
    if (url.includes('/versions') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { action?: string }
      return {
        ok: true,
        status: body.action === 'fork' ? 201 : 200,
        json: async () => ({
          success: true,
          data: {
            canvas: {
              id: body.action === 'fork' ? 'canvas-fork' : 'canvas-1',
              orgId: 'org-1',
              title: body.action === 'fork' ? 'Launch Canvas fork v2' : 'Launch Canvas',
              purpose: 'Product launch',
              status: 'draft',
              activeVersion: body.action === 'fork' ? 1 : 3,
              linked: { projectId: 'project-1' },
              nodes: [{
                id: body.action === 'fork' ? 'fork-source' : 'restored-source',
                orgId: 'org-1',
                type: 'source',
                title: body.action === 'fork' ? 'Fork source' : 'Restored source',
                position: { x: 0, y: 0 },
                data: {},
              }],
              edges: [],
            },
            version: { id: body.action === 'fork' ? 'fork-v1' : 'v3', version: body.action === 'fork' ? 1 : 3 },
          },
        }),
      }
    }
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
      if (url.includes('/sources/upload') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              source: {
                id: 'upload:upload-2',
                title: 'new-product.png',
                description: 'Upload / image/png',
                source: {
                  kind: 'upload',
                  refId: 'upload-2',
                  url: 'https://cdn.example.com/new-product.png',
                  thumbnailUrl: 'https://cdn.example.com/new-product-thumb.png',
                  previewUrl: 'https://cdn.example.com/new-product.png',
                  storagePath: 'creative-canvas/org-1/canvas-1/new-product.png',
                  mimeType: 'image/png',
                  altText: 'New product angle',
                  referenceRole: 'product',
                  weight: 1,
                },
              },
            },
          }),
        }
      }
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
          data: {
            run: { id: 'run-1', status: 'queued', nodeId: 'model-node-1', providerKey: 'higgsfield', input: {}, provenance: {} },
            agentTaskDraft: {
              agentInput: {
                providerExecution: {
                  cli: { display: "higgsfield generate create nano_banana_flash --prompt 'Generate a reviewable creative asset' --json" },
                  dispatch: { path: '/api/v1/creative-canvas/canvas-1/runs/run-1/provider-dispatch?orgId=org-1' },
                  callback: { path: '/api/v1/creative-canvas/provider-callbacks/higgsfield' },
                  statusRefresh: { path: '/api/v1/creative-canvas/canvas-1/runs/run-1/provider-status?orgId=org-1' },
                },
              },
            },
          },
        }),
      }
    }
    if (url.endsWith('/runs?orgId=org-1')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            operations: {
              total: 2,
              active: 1,
              failed: 1,
              retryableFailures: 1,
              completed: 0,
              byStatus: { queued: 0, running: 1, waiting_for_review: 0, completed: 0, failed: 1, cancelled: 0 },
              providers: [{
                providerKey: 'higgsfield',
                total: 2,
                active: 1,
                failed: 1,
                retryableFailures: 1,
                completed: 0,
                byStatus: { queued: 0, running: 1, waiting_for_review: 0, completed: 0, failed: 1, cancelled: 0 },
                latestProviderStatusMessage: 'Rendering preview frames',
                latestErrorMessage: 'Quota exceeded',
              }],
            },
            runs: [
              {
                id: 'run-existing',
                orgId: 'org-1',
                canvasId: 'canvas-1',
                nodeId: 'model-node-existing',
                providerKey: 'higgsfield',
                model: 'nano_banana_flash',
                status: 'running',
                providerStatusMessage: 'Rendering preview frames',
                input: { sourceNodeIds: [], sourceArtifactIds: [] },
                provenance: {
                  generatedBy: 'agent',
                  agentId: 'maya',
                  providerJobId: 'hf-job-existing',
                  promptStored: 'summary',
                  syntheticMedia: true,
                },
              },
              {
                id: 'run-failed',
                orgId: 'org-1',
                canvasId: 'canvas-1',
                nodeId: 'model-node-failed',
                providerKey: 'higgsfield',
                status: 'failed',
                input: { sourceNodeIds: [], sourceArtifactIds: [] },
                provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
                error: { code: 'quota', message: 'Quota exceeded', retryable: true },
              },
            ],
          },
        }),
      }
    }
    if (url.includes('/runs/run-failed/retry') && init?.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            run: {
              id: 'run-failed',
              orgId: 'org-1',
              canvasId: 'canvas-1',
              nodeId: 'model-node-failed',
              providerKey: 'higgsfield',
              status: 'queued',
              providerStatus: 'retry_queued',
              providerStatusMessage: 'Retry queued for provider runtime drain.',
              input: { sourceNodeIds: [], sourceArtifactIds: [] },
              provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
            },
          },
        }),
      }
    }
    if (url.includes('/runs/run-1/provider-status') && init?.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            run: {
              id: 'run-1',
              status: 'running',
              nodeId: 'model-node-1',
              providerKey: 'higgsfield',
              providerStatus: 'poll_requested',
              providerStatusMessage: 'Manual status refresh requested from Creative Canvas.',
              input: {},
              provenance: {},
            },
          },
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
    if (url.includes('/orchestration-tasks') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            projectId: 'project-1',
            createdTasks: [
              { id: 'task-1', nodeId: 'source-1', agentId: 'pip' },
              { id: 'task-2', nodeId: 'model-1', agentId: 'maya' },
            ],
            skippedSteps: [],
          },
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
            linked: { projectId: 'project-1' },
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
    expect(screen.getByText('Workflow presets')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply social launch workflow/i })).toBeInTheDocument()
    expect(screen.getByText('Run history')).toBeInTheDocument()
    expect(screen.getByText('Provider operations')).toBeInTheDocument()
    expect(screen.getByText('1 active / 2 total')).toBeInTheDocument()
    expect(screen.getByText('1 retryable provider failure')).toBeInTheDocument()
    expect(screen.getByText(/1 active · 0 completed · 1 failed/i)).toBeInTheDocument()
    expect(screen.getAllByText('Quota exceeded').length).toBeGreaterThan(0)
    expect(screen.getByText('Agent orchestration')).toBeInTheDocument()
    expect(screen.getByText('Provider job: hf-job-existing')).toBeInTheDocument()
    expect(screen.getByText('Versions')).toBeInTheDocument()
    expect(screen.getByText('Comments')).toBeInTheDocument()
    expect(screen.getByText('Output attachment')).toBeInTheDocument()
    expect(screen.getByText('Review gate')).toBeInTheDocument()
    expect(screen.getByText('Exports')).toBeInTheDocument()
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save graph/i })).toBeInTheDocument()
  })

  it('retries a failed retryable provider run from run history', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Provider operations')
    fireEvent.click(screen.getByRole('button', { name: /retry provider run/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/runs/run-failed/retry?orgId=org-1', expect.objectContaining({
        method: 'PUT',
      }))
    })
    expect(await screen.findByText('Retry queued: run-failed')).toBeInTheDocument()
  })

  it('adds a source node from the palette', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add source node/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/source node/i).length).toBeGreaterThan(0)
    })
  })

  it('applies a social launch workflow preset and saves the connected graph', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /apply social launch workflow/i }))

    expect(await screen.findByText(/social launch workflow added/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Product \/ brand source/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/UGC launch prompt/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Brand and rights review/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/maya:generation_operator/i)).toBeInTheDocument()
    expect(screen.getByText(/maya · reviewer/i)).toBeInTheDocument()
    expect(screen.getByText(/Brand and rights review: maya · rights needs_review · brand needs_review/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create agent tasks/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/orchestration-tasks?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
    const taskCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/orchestration-tasks'))
    expect(JSON.parse(taskCall?.[1]?.body as string)).toMatchObject({ projectId: 'project-1' })
    expect(await screen.findByText(/created 2 agent tasks/i)).toBeInTheDocument()
    expect((screen.getByLabelText(/output kind/i) as HTMLSelectElement).value).toBe('social_post_draft')
    expect((screen.getByLabelText(/export target/i) as HTMLSelectElement).value).toBe('social_draft')
    expect((screen.getByLabelText(/aspect ratio/i) as HTMLSelectElement).value).toBe('9:16')

    fireEvent.click(screen.getByRole('button', { name: /save graph/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/graph?orgId=org-1', expect.objectContaining({
        method: 'PUT',
      }))
    })
    const graphCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/graph?orgId=org-1') && init?.method === 'PUT'
    )
    const body = JSON.parse(graphCall?.[1]?.body as string)
    expect(body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'source',
        title: 'Product / brand source',
        data: expect.objectContaining({
          createdFrom: 'creative_canvas_workflow_preset',
          workflowPreset: 'social-launch',
        }),
        source: expect.objectContaining({
          referenceRole: 'product',
        }),
      }),
      expect.objectContaining({
        type: 'model',
        title: 'Higgsfield vertical video',
        provider: expect.objectContaining({
          key: 'higgsfield',
          mode: 'vertical_social',
        }),
        edit: expect.objectContaining({
          operation: 'video_motion',
          outputKind: 'social_post_draft',
        }),
      }),
      expect.objectContaining({
        type: 'output',
        title: 'Social post draft',
        output: expect.objectContaining({
          kind: 'social_post_draft',
        }),
      }),
    ]))
    expect(body.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'generate',
        data: expect.objectContaining({
          workflowPreset: 'social-launch',
        }),
      }),
      expect.objectContaining({
        label: 'approved draft',
      }),
    ]))
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

  it('filters the source library with search, source kind, role, and media type controls', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.change(screen.getByLabelText(/search sources/i), { target: { value: 'Product' } })
    fireEvent.change(screen.getByLabelText(/source kind/i), { target: { value: 'upload' } })
    fireEvent.change(screen.getByLabelText(/reference role/i), { target: { value: 'product' } })
    fireEvent.change(screen.getByLabelText(/media type/i), { target: { value: 'image' } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/creative-canvas/sources?'))
    })
    expect(fetchMock.mock.calls.some(([url]) => {
      const text = String(url)
      return text.includes('q=Product')
        && text.includes('sourceKind=upload')
        && text.includes('referenceRole=product')
        && text.includes('mediaType=image')
    })).toBe(true)
  })

  it('uploads a new source and imports it into the graph', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.change(screen.getByLabelText(/alt text/i), { target: { value: 'New product angle' } })
    fireEvent.change(screen.getByLabelText(/choose media or pdf/i), {
      target: {
        files: [new File(['image-bytes'], 'new-product.png', { type: 'image/png' })],
      },
    })

    expect(await screen.findByText(/source uploaded: new-product.png/i)).toBeInTheDocument()
    expect(await screen.findByAltText('Reference preview: New product angle')).toHaveAttribute(
      'src',
      'https://cdn.example.com/new-product-thumb.png',
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/sources/upload', expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData),
    }))
  })

  it('adds an edit node with mask and inpainting controls', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add edit node/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/edit node/i).length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Edit controls')).toBeInTheDocument()
    expect(screen.getAllByText('inpaint / image')[0]).toBeInTheDocument()
    expect(screen.getByText('Mask: not attached')).toBeInTheDocument()
  })

  it('applies a mask region to an edit node and saves it with the graph', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add edit node/i }))

    fireEvent.change(screen.getByLabelText(/mask x/i), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText(/mask y/i), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText(/mask width/i), { target: { value: '44' } })
    fireEvent.change(screen.getByLabelText(/mask height/i), { target: { value: '52' } })
    fireEvent.change(screen.getByLabelText(/mask feather/i), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: /apply mask region/i }))

    expect(await screen.findByText('Mask: region attached')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /save graph/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/graph?orgId=org-1', expect.objectContaining({
        method: 'PUT',
      }))
    })
    const graphCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/graph?orgId=org-1') && init?.method === 'PUT'
    )
    expect(JSON.parse(graphCall?.[1]?.body as string)).toMatchObject({
      nodes: [
        expect.objectContaining({
          type: 'edit',
          edit: expect.objectContaining({
            mask: {
              region: { x: 12, y: 18, width: 44, height: 52, unit: 'percent', feather: 6 },
            },
          }),
        }),
      ],
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

  it('restores a saved graph version from the versions panel', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText(/version 2/i)
    fireEvent.click(screen.getByRole('button', { name: /restore/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/versions?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
    const versionCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/versions?orgId=org-1') && init?.method === 'POST'
    )
    expect(JSON.parse(versionCall?.[1]?.body as string)).toMatchObject({
      action: 'restore',
      versionId: 'v2',
    })
    expect(await screen.findByText('restored-source')).toBeInTheDocument()
    expect(screen.getByText('Restored version 2')).toBeInTheDocument()
  })

  it('forks a saved graph version into a new canvas branch', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText(/version 2/i)
    fireEvent.click(screen.getByRole('button', { name: /fork/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/versions?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
    const versionCall = [...fetchMock.mock.calls].reverse().find(([url, init]) =>
      String(url).includes('/versions?orgId=org-1') && init?.method === 'POST'
    )
    expect(JSON.parse(versionCall?.[1]?.body as string)).toMatchObject({
      action: 'fork',
      versionId: 'v2',
    })
    expect(await screen.findByText('Launch Canvas fork v2')).toBeInTheDocument()
    expect(screen.getByText('fork-source')).toBeInTheDocument()
    expect(screen.getByText('Forked version 2')).toBeInTheDocument()
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
    expect(screen.getByText('Higgsfield execution')).toBeInTheDocument()
    expect(screen.getByText(/higgsfield generate create nano_banana_flash/i)).toBeInTheDocument()
    expect(screen.getByText('Dispatch: /api/v1/creative-canvas/canvas-1/runs/run-1/provider-dispatch?orgId=org-1')).toBeInTheDocument()
    expect(screen.getByText('Status: /api/v1/creative-canvas/canvas-1/runs/run-1/provider-status?orgId=org-1')).toBeInTheDocument()
    expect(screen.getByText('Provider status: Rendering preview frames')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /refresh provider status/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/runs/run-1/provider-status?orgId=org-1', expect.objectContaining({
        method: 'PUT',
      }))
    })
    expect(await screen.findByText(/run status refreshed: run-1/i)).toBeInTheDocument()
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
