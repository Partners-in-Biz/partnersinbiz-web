import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function dispatchBrushPointerEvent(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
) {
  act(() => {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }))
  })
}

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
    if (url.includes('/graph?orgId=org-1') && init?.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            canvas: {
              id: 'canvas-1',
              orgId: 'org-1',
              title: 'Launch Canvas',
              purpose: 'Product launch',
              status: 'draft',
              activeVersion: 2,
              linked: { projectId: 'project-1' },
              nodes: [],
              edges: [],
            },
          },
        }),
      }
    }
    if (url.includes('/versions')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            versions: [{
              id: 'v2',
              version: 2,
              reason: 'graph_save',
              nodes: [{
                id: 'version-source',
                orgId: 'org-1',
                type: 'source',
                title: 'Version source',
                position: { x: 0, y: 0 },
                data: {},
              }],
              edges: [],
            }],
          },
        }),
      }
    }
    if (url.includes('/comments') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { nodeId?: string; body?: string; visibility?: string }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            comment: {
              id: 'comment-1',
              orgId: 'org-1',
              canvasId: 'canvas-1',
              nodeId: body.nodeId,
              body: body.body ?? 'Needs a stronger hook',
              visibility: body.visibility ?? 'admin_agents',
              resolved: false,
              createdBy: 'user-1',
              createdByType: 'user',
            },
          },
        }),
      }
    }
    if (url.includes('/comments')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { comments: [] },
        }),
      }
    }
    if (url.includes('/presence') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { selectedNodeId?: string }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            presence: [{
              id: 'canvas-1_user-1',
              orgId: 'org-1',
              canvasId: 'canvas-1',
              actorUid: 'user-1',
              actorType: 'user',
              displayName: 'You',
              selectedNodeId: body.selectedNodeId,
              focus: 'canvas',
              lastSeenAtMs: 1000,
              expiresAtMs: 46000,
            }],
          },
        }),
      }
    }
    if (url.includes('/presence')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            presence: [{
              id: 'canvas-1_maya',
              orgId: 'org-1',
              canvasId: 'canvas-1',
              actorUid: 'maya',
              actorType: 'agent',
              displayName: 'Maya',
              selectedNodeId: 'model-node-existing',
              focus: 'runs',
              lastSeenAtMs: 900,
              expiresAtMs: 45900,
            }],
          },
        }),
      }
    }
    if (url.includes('/runtime-proof')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            proof: {
              canvasId: 'canvas-1',
              orgId: 'org-1',
              status: 'warning',
              readyForLiveProof: false,
              summary: '0 blockers and 2 warnings remain before live proof.',
              checks: [
                { id: 'project_link', label: 'Linked project', status: 'passed', evidence: 'Project project-1' },
                { id: 'runtime_readiness', label: 'Higgsfield runtime readiness', status: 'warning', evidence: 'Submit configured, status configured, internal bridge yes.' },
                { id: 'provider_runs', label: 'Provider run evidence', status: 'warning', evidence: '2 runs, 0 completed, 1 active, 1 failed.' },
                { id: 'output_assets', label: 'Output asset evidence', status: 'blocked', evidence: '0 assets, 0 draft-exportable output assets.' },
                { id: 'repeated_job_coverage', label: 'Repeated creative job coverage', status: 'blocked', evidence: 'Image: 0/0 completed; Video/social: 0/1 completed; Blog/document: 0/0 completed; Book: 0/0 completed' },
                { id: 'repeated_job_reliability', label: 'Repeated creative job reliability', status: 'warning', evidence: '2 total runs, 0 completed, 1 failed, 50% failure rate, 1 stale active.' },
              ],
            },
          },
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
    if (url.includes('/exports/package') && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            exportId: 'package-1',
            package: {
              status: 'internal_package',
              assetCount: 1,
              targets: ['social_draft'],
            },
          },
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
              staleActiveRuns: 1,
              oldestActiveRunAgeMinutes: 74,
              staleThresholdMinutes: 30,
              failed: 1,
              retryableFailures: 1,
              completed: 0,
              byStatus: { queued: 0, running: 1, waiting_for_review: 0, completed: 0, failed: 1, cancelled: 0 },
              providers: [{
                providerKey: 'higgsfield',
                total: 2,
                active: 1,
                staleActiveRuns: 1,
                oldestActiveRunAgeMinutes: 74,
                failed: 1,
                retryableFailures: 1,
                completed: 0,
                byStatus: { queued: 0, running: 1, waiting_for_review: 0, completed: 0, failed: 1, cancelled: 0 },
                latestProviderStatusMessage: 'Rendering preview frames',
                latestErrorMessage: 'Quota exceeded',
              }],
            },
            runtimeReadiness: {
              providerKey: 'higgsfield',
              runtimeConfigured: true,
              submitConfigured: true,
              statusPollingConfigured: true,
              internalBridgeConfigured: true,
              callbackBaseConfigured: true,
              webhookSecretConfigured: false,
              linkedProjectId: 'project-1',
              blockers: [],
              warnings: ['Provider webhook secret is not configured'],
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
    if (url.includes('/runs/retry') && init?.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            retriedRuns: [{
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
            }],
            skippedRuns: [],
            operations: {
              total: 2,
              active: 2,
              staleActiveRuns: 0,
              staleThresholdMinutes: 30,
              failed: 0,
              retryableFailures: 0,
              completed: 0,
              byStatus: { queued: 1, running: 1, waiting_for_review: 0, completed: 0, failed: 0, cancelled: 0 },
              providers: [{
                providerKey: 'higgsfield',
                total: 2,
                active: 2,
                staleActiveRuns: 0,
                failed: 0,
                retryableFailures: 0,
                completed: 0,
                byStatus: { queued: 1, running: 1, waiting_for_review: 0, completed: 0, failed: 0, cancelled: 0 },
              }],
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
    expect(screen.getByText('Runtime readiness')).toBeInTheDocument()
    expect(screen.getByText('Submit yes · Status yes · Project project-1')).toBeInTheDocument()
    expect(screen.getByText('Live proof status')).toBeInTheDocument()
    expect(screen.getByText('0 blockers and 2 warnings remain before live proof.')).toBeInTheDocument()
    expect(screen.getByText('Provider run evidence')).toBeInTheDocument()
    expect(screen.getByText('Repeated creative job coverage')).toBeInTheDocument()
    expect(screen.getByText(/Image: 0\/0 completed/i)).toBeInTheDocument()
    expect(screen.getByText(/1 active provider run older than 30 min/i)).toBeInTheDocument()
    expect(screen.getByText(/1 stale active · oldest 74 min/i)).toBeInTheDocument()
    expect(screen.getByText('1 retryable provider failure')).toBeInTheDocument()
    expect(screen.getByText(/1 active · 0 completed · 1 failed/i)).toBeInTheDocument()
    expect(screen.getAllByText('Quota exceeded').length).toBeGreaterThan(0)
    expect(screen.getByText('Agent orchestration')).toBeInTheDocument()
    expect(screen.getByText('Provider job: hf-job-existing')).toBeInTheDocument()
    expect(screen.getByText('Live collaborators')).toBeInTheDocument()
    expect(screen.getByText('Maya')).toBeInTheDocument()
    expect(screen.getByText('runs / model-node-existing')).toBeInTheDocument()
    expect(screen.getByText('Versions')).toBeInTheDocument()
    expect(screen.getByText('1 nodes / 0 links')).toBeInTheDocument()
    expect(screen.getByText('+1 / -0 changes')).toBeInTheDocument()
    expect(screen.getByText('Changed: Version source')).toBeInTheDocument()
    expect(screen.getByText('Comments')).toBeInTheDocument()
    expect(screen.getByText('Output attachment')).toBeInTheDocument()
    expect(screen.getByText('Review gate')).toBeInTheDocument()
    expect(screen.getByText('Exports')).toBeInTheDocument()
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save graph/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /creative canvas mobile sections/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /canvas graph workspace/i })).toHaveClass('block')
    expect(screen.getByRole('complementary', { name: /source and workflow tools/i })).toHaveClass('hidden')
  })

  it('switches mobile panels without removing desktop canvas sections', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    const canvasButton = screen.getByRole('button', { name: /^canvas \(/i })
    const sourcesButton = screen.getByRole('button', { name: /^sources$/i })
    const inspectorButton = screen.getByRole('button', { name: /^inspector$/i })
    const canvasPanel = screen.getByRole('region', { name: /canvas graph workspace/i })
    const sourcesPanel = screen.getByRole('complementary', { name: /source and workflow tools/i })
    const inspectorPanel = screen.getByRole('complementary', { name: /canvas inspector and outputs/i })

    expect(canvasButton).toHaveAttribute('aria-pressed', 'true')
    expect(canvasPanel).toHaveClass('block')
    expect(sourcesPanel).toHaveClass('hidden')
    expect(inspectorPanel).toHaveClass('hidden')

    fireEvent.click(sourcesButton)
    expect(sourcesButton).toHaveAttribute('aria-pressed', 'true')
    expect(sourcesPanel).toHaveClass('block')
    expect(canvasPanel).toHaveClass('hidden')

    fireEvent.click(inspectorButton)
    expect(inspectorButton).toHaveAttribute('aria-pressed', 'true')
    expect(inspectorPanel).toHaveClass('block')
    expect(sourcesPanel).toHaveClass('hidden')
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

  it('batch retries all retryable provider failures from operations', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Provider operations')
    fireEvent.click(screen.getByRole('button', { name: /retry all retryable/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/runs/retry?orgId=org-1', expect.objectContaining({
        method: 'PUT',
      }))
    })
    expect(await screen.findByText('Retried 1 provider run')).toBeInTheDocument()
    expect(screen.getByText('2 active / 2 total')).toBeInTheDocument()
  })

  it('adds a source node from the palette', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add source node/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/source node/i).length).toBeGreaterThan(0)
    })
  })

  it('surfaces a graph save conflict when another session has a newer version', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/graph?orgId=org-1') && init?.method === 'PUT') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            success: false,
            code: 'creative_canvas_version_conflict',
            currentActiveVersion: 4,
            expectedActiveVersion: 1,
            conflicts: ['node:source-1', 'edge:source-model'],
            error: 'Creative canvas graph has changed since it was loaded',
          }),
        }
      }
      if (url.includes('/versions')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { versions: [{ id: 'v4', version: 4, reason: 'graph_save' }] },
          }),
        }
      }
      if (url.includes('/presence')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { presence: [] } }),
        }
      }
      return {
        ok: true,
        json: async () => ({ success: true, data: {} }),
      }
    })

    fireEvent.click(screen.getByRole('button', { name: /save graph/i }))

    expect(await screen.findByText(/2 overlapping edits need review/i)).toBeInTheDocument()
    const graphCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/graph?orgId=org-1') && init?.method === 'PUT'
    )
    expect(JSON.parse(graphCall?.[1]?.body as string)).toMatchObject({
      expectedActiveVersion: 1,
      mergeOnConflict: true,
      baseGraph: { nodes: [], edges: [] },
    })
  })

  it('detects and applies a newer live graph from another collaborator', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/creative-canvas/canvas-1?orgId=org-1') && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              canvas: {
                id: 'canvas-1',
                orgId: 'org-1',
                title: 'Launch Canvas',
                purpose: 'Product launch',
                status: 'draft',
                activeVersion: 2,
                linked: { projectId: 'project-1' },
                nodes: [{
                  id: 'remote-model-node',
                  orgId: 'org-1',
                  type: 'model',
                  title: 'Remote collaborator model',
                  position: { x: 120, y: 140 },
                  data: {},
                  provider: { key: 'higgsfield', model: 'nano_banana_flash' },
                }],
                edges: [],
              },
            },
          }),
        }
      }
      if (url.includes('/versions')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { versions: [{ id: 'v2', version: 2, reason: 'collaborator_graph_save' }] },
          }),
        }
      }
      if (url.includes('/presence')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { presence: [] } }),
        }
      }
      if (url.includes('/runs')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { runs: [] } }),
        }
      }
      if (url.includes('/runtime-proof')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { proof: null } }),
        }
      }
      return {
        ok: true,
        json: async () => ({ success: true, data: {} }),
      }
    })

    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }))

    expect(await screen.findByText('Live graph update available')).toBeInTheDocument()
    expect(screen.getByText(/another collaborator saved v2/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /apply latest graph/i }))

    expect(await screen.findByText('remote-model-node')).toBeInTheDocument()
    expect(await screen.findByText('Applied live graph v2')).toBeInTheDocument()
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
    expect(screen.getAllByLabelText(/export target/i).some((element) => (element as HTMLSelectElement).value === 'social_draft')).toBe(true)
    expect((screen.getByLabelText(/aspect ratio/i) as HTMLSelectElement).value).toBe('9:16')
    fireEvent.change(screen.getByLabelText(/higgsfield model id/i), { target: { value: 'seedance_2_0_fast' } })
    fireEvent.change(screen.getByLabelText(/duration seconds/i), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText(/variants/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/negative prompt/i), { target: { value: 'no off-brand props' } })
    fireEvent.click(screen.getByRole('button', { name: /apply settings to node/i }))
    expect(await screen.findByText(/generation settings applied to higgsfield vertical video/i)).toBeInTheDocument()

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
    expect(body.expectedActiveVersion).toBe(1)
    expect(body.mergeOnConflict).toBe(true)
    expect(body.baseGraph).toEqual({ nodes: [], edges: [] })
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
        data: expect.objectContaining({
          generationSettings: expect.objectContaining({
            aspectRatio: '9:16',
            durationSeconds: 12,
            variantCount: 3,
            negativePrompt: 'no off-brand props',
          }),
        }),
        provider: expect.objectContaining({
          key: 'higgsfield',
          model: 'seedance_2_0_fast',
          mode: 'social_post_draft',
        }),
        edit: expect.objectContaining({
          operation: 'video_motion',
          outputKind: 'social_post_draft',
          motion: expect.objectContaining({
            durationSeconds: 12,
          }),
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

    expect(await screen.findByLabelText('Reference preview: Product bottle.png')).toHaveStyle({
      backgroundImage: 'url(https://cdn.example.com/product-thumb.png)',
    })
    expect(screen.getByText('product / 1')).toBeInTheDocument()
    expect(screen.getByText('Asset gallery')).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText('Internal asset')).toBeInTheDocument()
  })

  it('selects an output asset and exports it as a downstream draft', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /apply social launch workflow/i }))

    expect(await screen.findByText(/social launch workflow added/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/asset filter/i), { target: { value: 'output_node' } })
    fireEvent.click(screen.getByRole('button', { name: /select asset social post draft/i }))

    expect(screen.getByText('Draft export available')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/export target/i).some((element) => (element as HTMLSelectElement).value === 'social_draft')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /add to compare/i }))
    expect(screen.getByText('Compare assets')).toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /export selected asset draft/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/exports/draft?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
    const exportCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/exports/draft?orgId=org-1') && init?.method === 'POST'
    )
    expect(JSON.parse(exportCall?.[1]?.body as string)).toMatchObject({
      nodeId: expect.stringContaining('social-launch-output'),
      target: 'social_draft',
    })
    expect(await screen.findByText('Draft export prepared')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /prepare package/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/exports/package?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
    const packageCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/exports/package?orgId=org-1') && init?.method === 'POST'
    )
    expect(JSON.parse(packageCall?.[1]?.body as string)).toMatchObject({
      nodeIds: [expect.stringContaining('social-launch-output')],
      title: 'Creative package: Launch Canvas',
    })
    expect(await screen.findByText('Export package prepared')).toBeInTheDocument()
    expect(screen.getByText(/Package package-1: 1 assets/i)).toBeInTheDocument()
  })

  it('edits selected source asset metadata and saves it with the graph', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    expect(await screen.findByText('Product bottle.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /import product bottle.png/i }))

    await screen.findByText('Asset gallery')
    fireEvent.click(screen.getByRole('button', { name: /select asset product bottle.png/i }))
    fireEvent.change(screen.getByLabelText(/asset title/i), { target: { value: 'Hero product source' } })
    fireEvent.change(screen.getByLabelText(/preview notes/i), { target: { value: 'Use as the primary product reference' } })

    fireEvent.click(screen.getByRole('button', { name: /save graph/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/graph?orgId=org-1', expect.objectContaining({
        method: 'PUT',
      }))
    })
    const graphCall = [...fetchMock.mock.calls].reverse().find(([url, init]) =>
      String(url).includes('/graph?orgId=org-1') && init?.method === 'PUT'
    )
    expect(JSON.parse(graphCall?.[1]?.body as string)).toMatchObject({
      expectedActiveVersion: 1,
      mergeOnConflict: true,
      baseGraph: { nodes: [], edges: [] },
      nodes: [
        expect.objectContaining({
          type: 'source',
          title: 'Hero product source',
          source: expect.objectContaining({
            altText: 'Use as the primary product reference',
          }),
        }),
      ],
    })
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
    expect(await screen.findByLabelText('Reference preview: New product angle')).toHaveStyle({
      backgroundImage: 'url(https://cdn.example.com/new-product-thumb.png)',
    })
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
      expectedActiveVersion: 1,
      mergeOnConflict: true,
      baseGraph: { nodes: [], edges: [] },
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

  it('uses visual mask presets for Higgsfield-style inpainting regions', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add edit node/i }))

    expect(screen.getByLabelText('Mask preview overlay')).toHaveStyle({
      left: '0%',
      top: '0%',
      width: '50%',
      height: '50%',
    })

    fireEvent.click(screen.getByRole('button', { name: /product placement/i }))

    expect(screen.getByLabelText('Mask preview overlay')).toHaveStyle({
      left: '56%',
      top: '48%',
      width: '30%',
      height: '34%',
    })
    expect(screen.getByText('30x34% · feather 6 · 0 brush')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /apply mask region/i }))
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
      expectedActiveVersion: 1,
      mergeOnConflict: true,
      baseGraph: { nodes: [], edges: [] },
      nodes: [
        expect.objectContaining({
          type: 'edit',
          edit: expect.objectContaining({
            mask: {
              region: { x: 56, y: 48, width: 30, height: 34, unit: 'percent', feather: 6 },
            },
          }),
        }),
      ],
    })
  })

  it('captures brush mask strokes and saves them with the graph', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add edit node/i }))
    fireEvent.change(screen.getByLabelText(/brush size/i), { target: { value: '12' } })
    const brushCanvas = screen.getByRole('application', { name: /brush mask canvas/i })
    jest.spyOn(brushCanvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect)
    dispatchBrushPointerEvent(brushCanvas, 'pointerdown', 40, 40)
    dispatchBrushPointerEvent(brushCanvas, 'pointermove', 80, 50)
    dispatchBrushPointerEvent(brushCanvas, 'pointerup', 80, 50)

    expect(await screen.findByText('Mask: brush attached')).toBeInTheDocument()
    expect(screen.getByText(/1 brush/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Brush mask point 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Brush mask point 2')).toBeInTheDocument()

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
      expectedActiveVersion: 1,
      mergeOnConflict: true,
      baseGraph: { nodes: [], edges: [] },
      nodes: [
        expect.objectContaining({
          type: 'edit',
          edit: expect.objectContaining({
            mask: expect.objectContaining({
              brush: {
                strokes: [
                  expect.objectContaining({
                    points: [{ x: 20, y: 40 }, { x: 40, y: 50 }],
                    size: 12,
                    mode: 'paint',
                    unit: 'percent',
                  }),
                ],
              },
            }),
          }),
        }),
      ],
    })
  })

  it('loads versions and posts comments for the active canvas', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    expect(await screen.findByText(/version 2/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add source node/i }))

    fireEvent.change(screen.getByLabelText(/comment body/i), {
      target: { value: 'Needs a stronger hook' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/creative-canvas/canvas-1/comments?orgId=org-1', expect.objectContaining({
        method: 'POST',
      }))
    })
    const commentCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/comments?orgId=org-1') && init?.method === 'POST'
    )
    expect(JSON.parse(commentCall?.[1]?.body as string)).toMatchObject({
      nodeId: expect.stringContaining('source-node-'),
      body: 'Needs a stronger hook',
    })
    expect(await screen.findByText('Selected node thread')).toBeInTheDocument()
    expect(screen.getByText('Needs a stronger hook')).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText(/higgsfield model id/i), { target: { value: 'nano_banana_pro' } })
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
      model: 'nano_banana_pro',
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

  it('queues edit runs with brush mask geometry for agents', async () => {
    render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)

    await screen.findByText('Launch Canvas')
    fireEvent.click(screen.getByRole('button', { name: /add edit node/i }))
    const brushCanvas = screen.getByRole('application', { name: /brush mask canvas/i })
    jest.spyOn(brushCanvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect)
    dispatchBrushPointerEvent(brushCanvas, 'pointerdown', 40, 40)
    dispatchBrushPointerEvent(brushCanvas, 'pointermove', 80, 50)
    dispatchBrushPointerEvent(brushCanvas, 'pointerup', 80, 50)
    fireEvent.click(screen.getByRole('button', { name: /queue run/i }))

    await screen.findByText(/run queued: run-1/i)
    const runCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith('/runs?orgId=org-1') && init?.method === 'POST'
    )
    expect(JSON.parse(runCall?.[1]?.body as string)).toMatchObject({
      providerKey: 'higgsfield',
      input: {
        outputKind: 'image',
        operation: 'inpaint',
        editMask: expect.objectContaining({
          brush: {
            strokes: [
              expect.objectContaining({
                points: [{ x: 20, y: 40 }, { x: 40, y: 50 }],
                unit: 'percent',
              }),
            ],
          },
        }),
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

    expect(await screen.findByLabelText('Reference preview: Red product bottle')).toHaveStyle({
      backgroundImage: 'url(https://cdn.example.com/product-thumb.png)',
    })
    expect(screen.getByText('product / 0.8')).toBeInTheDocument()
  })
})
