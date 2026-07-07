/** @jest-environment jsdom */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@/lib/portal/scoped-routing', () => ({
  scopedApiPath: (path: string, scope?: { orgId?: string }) => {
    if (!scope?.orgId) return path
    return `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(scope.orgId)}`
  },
}))

import { TemplateBrowserPanel } from '@/components/video-editor/TemplateBrowserPanel'
import type { EditorTimeline } from '@/lib/video-editor/types'

const fragment: EditorTimeline = {
  version: 1,
  tracks: [{
    id: 'track-text',
    kind: 'text',
    clips: [{
      id: 'clip-title',
      timelineStart: 0,
      duration: 3,
      text: {
        content: 'Hello',
        fontSizePx: 64,
        color: '#ffffff',
        align: 'center',
        animationPreset: 'none',
      },
    }],
  }],
}

const templates = [
  {
    id: 'tpl-intro',
    orgId: 'platform',
    category: 'intro',
    title: 'Bold intro',
    description: 'Opening title',
    fragment,
    deleted: false,
  },
  {
    id: 'tpl-lower',
    orgId: 'org-1',
    category: 'lower_third',
    title: 'Name strap',
    fragment,
    deleted: false,
  },
]

describe('TemplateBrowserPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/resolve')) {
        return new Response(JSON.stringify({ success: true, data: { fragment } }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: { templates } }), { status: 200 })
    }) as unknown as typeof fetch
  })

  it('loads templates and filters by category', async () => {
    render(
      <TemplateBrowserPanel
        orgId="org-1"
        canSaveSelection={false}
        onInsert={jest.fn()}
        onSaveSelection={jest.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Bold intro')).toBeInTheDocument())
    expect(screen.getByText('Name strap')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'lower_third' } })

    await waitFor(() => expect(screen.getByText('Name strap')).toBeInTheDocument())
    expect(screen.queryByText('Bold intro')).not.toBeInTheDocument()
  })

  it('clears stale templates while a new category is loading', async () => {
    let resolveSecondLoad: ((value: Response) => void) | undefined
    let loadCount = 0
    global.fetch = jest.fn(async () => {
      loadCount += 1
      if (loadCount === 1) {
        return new Response(JSON.stringify({ success: true, data: { templates } }), { status: 200 })
      }
      return new Promise<Response>((resolve) => {
        resolveSecondLoad = resolve
      })
    }) as unknown as typeof fetch

    render(
      <TemplateBrowserPanel
        orgId="org-1"
        canSaveSelection={false}
        onInsert={jest.fn()}
        onSaveSelection={jest.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Bold intro')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'lower_third' } })

    expect(screen.getByText('Loading templates...')).toBeInTheDocument()
    expect(screen.queryByText('Bold intro')).not.toBeInTheDocument()
    resolveSecondLoad?.(new Response(JSON.stringify({ success: true, data: { templates: [templates[1]] } }), { status: 200 }))
    await waitFor(() => expect(screen.getByText('Name strap')).toBeInTheDocument())
  })

  it('resolves a template before insertion', async () => {
    const onInsert = jest.fn()
    render(
      <TemplateBrowserPanel
        orgId="org-1"
        channelWorkspaceId="channel-1"
        canSaveSelection={false}
        onInsert={onInsert}
        onSaveSelection={jest.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Bold intro')).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert at playhead' })[0])

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith(fragment))
    const resolveCall = (global.fetch as jest.Mock).mock.calls.find(([input]) => String(input).includes('/resolve'))
    expect(resolveCall?.[0]).toContain('/api/v1/video-editor/templates/tpl-intro/resolve?orgId=org-1')
    expect(JSON.parse(String(resolveCall?.[1]?.body))).toEqual({ channelWorkspaceId: 'channel-1' })
    expect(screen.getByRole('status')).toHaveTextContent('Inserted Bold intro.')
  })

  it('shows save selection only when a timeline selection can be saved', async () => {
    const onSaveSelection = jest.fn()
    const { rerender } = render(
      <TemplateBrowserPanel
        orgId="org-1"
        canSaveSelection={false}
        onInsert={jest.fn()}
        onSaveSelection={onSaveSelection}
      />,
    )

    expect(screen.queryByRole('button', { name: /save selection/i })).not.toBeInTheDocument()

    rerender(
      <TemplateBrowserPanel
        orgId="org-1"
        canSaveSelection
        onInsert={jest.fn()}
        onSaveSelection={onSaveSelection}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save selection/i }))

    await waitFor(() => expect(onSaveSelection).toHaveBeenCalledTimes(1))
  })
})
