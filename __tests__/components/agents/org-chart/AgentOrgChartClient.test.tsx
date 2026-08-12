import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import AgentOrgChartClient from '@/components/agents/org-chart/AgentOrgChartClient'

const canvasControls = {
  fit: jest.fn(),
  zoomIn: jest.fn(),
  zoomOut: jest.fn(),
}
let mockCanvasProps: Record<string, unknown> = {}

jest.mock('@/components/agents/org-chart/OrgChartCanvas', () => ({
  __esModule: true,
  default: forwardRef(function MockOrgChartCanvas(props, ref) {
    mockCanvasProps = props as Record<string, unknown>
    useImperativeHandle(ref, () => canvasControls)
    return <div data-testid="org-chart-canvas" />
  }),
}))

jest.mock('@/components/agents/org-chart/OrgNodeEditor', () => ({
  __esModule: true,
  default: () => null,
}))

describe('AgentOrgChartClient canvas controls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanvasProps = {}
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/agents/org-chart') {
        return { ok: true, json: async () => ({ data: { nodes: [], tree: [] } }) } as Response
      }
      if (url === '/api/v1/portal/settings/agents') {
        return { ok: true, json: async () => ({ data: { agents: [] } }) } as Response
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })
  })

  it('shows the complete live primary and fallback route on bound chart agents', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/settings/agents/org-chart') {
        return {
          ok: true,
          json: async () => ({ data: { nodes: [], tree: [] } }),
        } as Response
      }
      if (url === '/api/v1/admin/agents') {
        return {
          ok: true,
          json: async () => ({
            data: [{
              agentId: 'pip',
              defaultModel: 'grok-4.6',
              runtimeModel: {
                source: 'live_config',
                label: 'xai-oauth / grok-4.6 → nous / deepseek/deepseek-v4-flash-0731',
                primaryProvider: 'xai-oauth',
                primaryModel: 'grok-4.6',
                fallbackProvider: 'nous',
                fallbackModel: 'deepseek/deepseek-v4-flash-0731',
                staleRegistry: false,
              },
            }],
          }),
        } as Response
      }
      throw new Error(`Unhandled fetch: ${url}`)
    })

    render(
      <AgentOrgChartClient
        mode="portal"
        orgId="pib-platform-owner"
        canEdit
        apiBase="/api/v1/portal/settings/agents/org-chart"
        agentsListUrl="/api/v1/admin/agents"
        allowRuntimeTab
      />,
    )

    await waitFor(() => {
      expect(mockCanvasProps.liveModelByAgentId).toEqual({
        pip: 'xai-oauth / grok-4.6 → nous / deepseek/deepseek-v4-flash-0731',
      })
    })
  })

  it('exposes controls that operate the org-chart canvas view', async () => {
    render(
      <AgentOrgChartClient
        mode="portal"
        orgId="org-1"
        canEdit
        apiBase="/api/v1/portal/settings/agents/org-chart"
        agentsListUrl="/api/v1/portal/settings/agents"
      />,
    )

    const zoomOut = await screen.findByRole('button', { name: 'Zoom out' })
    const fitChart = screen.getByRole('button', { name: 'Fit chart' })
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })

    fireEvent.click(zoomOut)
    fireEvent.click(fitChart)
    fireEvent.click(zoomIn)

    expect(canvasControls.zoomOut).toHaveBeenCalledTimes(1)
    expect(canvasControls.fit).toHaveBeenCalledTimes(1)
    expect(canvasControls.zoomIn).toHaveBeenCalledTimes(1)
  })
})
