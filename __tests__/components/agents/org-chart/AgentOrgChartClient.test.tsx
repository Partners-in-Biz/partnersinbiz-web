import { fireEvent, render, screen } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import AgentOrgChartClient from '@/components/agents/org-chart/AgentOrgChartClient'

const canvasControls = {
  fit: jest.fn(),
  zoomIn: jest.fn(),
  zoomOut: jest.fn(),
}

jest.mock('@/components/agents/org-chart/OrgChartCanvas', () => ({
  __esModule: true,
  default: forwardRef(function MockOrgChartCanvas(_props, ref) {
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
