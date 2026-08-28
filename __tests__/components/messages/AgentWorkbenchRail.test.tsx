import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import AgentWorkbenchRail from '@/components/messages/workbench/AgentWorkbenchRail'
import { formatDesignAnnotation, WorkbenchBrowserPanel } from '@/components/messages/workbench/WorkbenchBrowserPanel'
import type { WorkbenchFilePreview, WorkbenchFilesSource, WorkbenchTab } from '@/lib/messages/workbench/types'

function Harness({ mapped = true, liveTree = false }: { mapped?: boolean; liveTree?: boolean }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<WorkbenchTab>('files')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<WorkbenchFilePreview | null>(null)
  return (
    <AgentWorkbenchRail
      open={open}
      activeTab={tab}
      onOpenChange={setOpen}
      onTabChange={(next) => { if (next) setTab(next) }}
      runtime={{ label: 'Peet Mac', mappingLabel: mapped ? 'PiB web' : null, projectName: 'PIB - Website', hasMapping: mapped }}
      terminalEntries={[{ id: 'command-1', status: 'done', label: 'terminal', meta: 'exit 0', body: '$ npm test\nPASS workbench' }]}
      fileTree={[{ name: 'components', path: 'components', kind: 'directory', children: [{ name: 'UnifiedChat.tsx', path: 'components/UnifiedChat.tsx', kind: 'file' }] }]}
      liveFileTree={liveTree ? [{ name: 'server.ts', path: 'server.ts', kind: 'file' }] : undefined}
      filesSource={liveTree ? ('sync' as WorkbenchFilesSource) : ('events' as WorkbenchFilesSource)}
      selectedFilePath={selectedFilePath}
      onSelectFilePath={(path) => {
        setSelectedFilePath(path)
        setPreview({ path, content: `content of ${path}`, loading: false, error: null })
      }}
      filePreview={preview}
      changes={[{ path: 'components/UnifiedChat.tsx', status: 'modified', patch: '@@\n-old\n+new' }]}
      browserTargets={[{ id: 'preview-1', url: 'https://preview.example.test', title: 'Preview', source: 'event' }]}
    />
  )
}

describe('AgentWorkbenchRail', () => {
  it('hides the closed icon rail on a phone-width first paint', () => {
    render(
      <AgentWorkbenchRail
        open={false}
        activeTab="files"
        onOpenChange={jest.fn()}
        onTabChange={jest.fn()}
        hideClosedIconStrip
        terminalEntries={[]}
        fileTree={[]}
        changes={[]}
        browserTargets={[]}
      />,
    )
    expect(screen.queryByTestId('agent-workbench-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-workbench-icon-strip')).not.toBeInTheDocument()
  })

  it('defaults closed and exposes all four observer panels', () => {
    render(<Harness />)

    expect(screen.getByTestId('agent-workbench-rail')).toHaveAttribute('data-open', 'false')
    for (const label of ['Files', 'Terminal', 'Browser', 'Changes']) expect(screen.getByLabelText(label)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Terminal'))
    expect(screen.getByTestId('agent-workbench-rail')).toHaveAttribute('data-open', 'true')
    expect(screen.getByText('$ npm test', { exact: false })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('agent-workbench-tab-changes'))
    expect(screen.getAllByText('components/UnifiedChat.tsx').length).toBeGreaterThan(0)
    expect(screen.getByText('@@', { exact: false })).toBeInTheDocument()
  })

  it('shows an honest fallback when no folder mapping is bound', () => {
    render(<Harness mapped={false} />)
    fireEvent.click(screen.getByLabelText('Files'))
    expect(screen.getByText(/No workspace mapping/)).toBeInTheDocument()
  })

  it('selecting a file shows its preview and prefers the live sync tree over the event-derived one', () => {
    render(<Harness liveTree />)
    fireEvent.click(screen.getByLabelText('Files'))

    expect(screen.getByText('server.ts')).toBeInTheDocument()
    expect(screen.queryByText('components')).not.toBeInTheDocument()
    expect(screen.getByText('Synced')).toBeInTheDocument()

    fireEvent.click(screen.getByText('server.ts'))
    expect(screen.getByText('content of server.ts')).toBeInTheDocument()
  })

  it('deep-links from a change into the Files tab with the file preselected', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('agent-workbench-tab-changes'))

    fireEvent.click(screen.getByRole('button', { name: 'Open in Files' }))

    expect(screen.getByTestId('agent-workbench-tab-files')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('content of components/UnifiedChat.tsx')).toBeInTheDocument()
  })
})

describe('WorkbenchBrowserPanel security boundary', () => {
  it('does not auto-load an observed URL and requires an explicit external-open preparation', () => {
    render(<WorkbenchBrowserPanel targets={[{ id: 'target', url: 'https://public-preview.example.test/app', title: 'Observed preview', source: 'event' }]} />)
    expect(screen.queryByRole('link', { name: 'Open preview in new tab' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Observed preview'))
    expect(screen.queryByRole('link', { name: 'Open preview in new tab' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(screen.getByRole('link', { name: 'Open preview in new tab' })).toHaveAttribute('href', 'https://public-preview.example.test/app')
    expect(screen.getByRole('link', { name: 'Open preview in new tab' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not auto-load an observed screenshot artifact', () => {
    render(<WorkbenchBrowserPanel targets={[{ id: 'image', imageUrl: 'https://cdn.example.test/screenshot.png', title: 'Screenshot', source: 'rich_part' }]} />)
    expect(screen.queryByRole('img', { name: 'Screenshot' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Screenshot'))
    expect(screen.queryByRole('img', { name: 'Screenshot' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(screen.getByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', 'https://cdn.example.test/screenshot.png')
  })

  it('blocks private-network preview URLs', () => {
    render(<WorkbenchBrowserPanel targets={[]} />)
    fireEvent.change(screen.getByLabelText('Browser target URL'), { target: { value: 'http://127.0.0.1:3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/private-network/)
    expect(screen.queryByRole('link', { name: 'Open observed URL' })).not.toBeInTheDocument()
  })

  it.each([
    'http://[::ffff:127.0.0.1]:3000',
    'http://[fec0::1]:3000',
    'http://[2001:10::1]',
    'http://198.51.100.10',
  ])('blocks non-public and reserved target %s', (url) => {
    render(<WorkbenchBrowserPanel targets={[]} />)
    fireEvent.change(screen.getByLabelText('Browser target URL'), { target: { value: url } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/private-network/)
    expect(screen.queryByRole('link', { name: 'Open observed URL' })).not.toBeInTheDocument()
  })

  it('starts an explicit screenshot stream and follows the newest agent frame', () => {
    const first = { id: 'frame-1', imageUrl: 'https://cdn.example.test/frame-1.png', title: 'Browser frame 1', source: 'event' as const }
    const { rerender } = render(<WorkbenchBrowserPanel targets={[first]} />)

    expect(screen.queryByRole('img', { name: 'Browser frame 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start live stream' }))
    expect(screen.getByRole('img', { name: 'Browser frame 1' })).toHaveAttribute('src', first.imageUrl)

    const second = { id: 'frame-2', imageUrl: 'https://cdn.example.test/frame-2.png', title: 'Browser frame 2', source: 'event' as const }
    rerender(<WorkbenchBrowserPanel targets={[first, second]} />)

    expect(screen.getByRole('img', { name: 'Browser frame 2' })).toHaveAttribute('src', second.imageUrl)
    expect(screen.getByText('Live · 2 frames')).toBeInTheDocument()
  })

  it('embeds an explicitly prepared public preview in a sandboxed iframe', () => {
    render(<WorkbenchBrowserPanel targets={[]} />)
    fireEvent.change(screen.getByLabelText('Browser target URL'), { target: { value: 'https://preview.example.test/app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))

    const preview = screen.getByTitle('Local app preview')
    expect(preview).toHaveAttribute('src', 'https://preview.example.test/app')
    expect(preview).toHaveAttribute('sandbox', 'allow-forms allow-modals allow-popups allow-scripts')
    expect(screen.getByRole('link', { name: 'Open preview in new tab' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('captures a Design Mode point, commits it as a pin, and sends that pin to chat without sending the message', () => {
    const onAddToChat = jest.fn()
    render(<WorkbenchBrowserPanel
      targets={[{ id: 'frame', imageUrl: 'https://cdn.example.test/frame.png', title: 'Pricing page', source: 'event' }]}
      onAddToChat={onAddToChat}
    />)
    fireEvent.click(screen.getByText('Pricing page'))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Design Mode' }))

    const overlay = screen.getByLabelText('Design Mode canvas')
    jest.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100, toJSON: () => ({}),
    })
    fireEvent.click(overlay, { clientX: 60, clientY: 70 })
    fireEvent.change(screen.getByLabelText('Design annotation'), { target: { value: 'Align this CTA with the price card.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pin' }))

    expect(onAddToChat).not.toHaveBeenCalled()
    expect(screen.getByText('Align this CTA with the price card.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add pin 1 to chat' }))

    expect(onAddToChat).toHaveBeenCalledWith(expect.stringContaining('Align this CTA with the price card.'))
    expect(onAddToChat).toHaveBeenCalledWith(expect.stringContaining('Point: 25%, 50%'))
  })

  it('supports multiple pins, "Add all to chat", removing a pin, and clearing every pin', () => {
    const onAddToChat = jest.fn()
    render(<WorkbenchBrowserPanel
      targets={[{ id: 'frame', imageUrl: 'https://cdn.example.test/frame.png', title: 'Pricing page', source: 'event' }]}
      onAddToChat={onAddToChat}
    />)
    fireEvent.click(screen.getByText('Pricing page'))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Design Mode' }))

    const overlay = screen.getByLabelText('Design Mode canvas')
    jest.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON: () => ({}),
    })

    fireEvent.click(overlay, { clientX: 20, clientY: 10 })
    fireEvent.change(screen.getByLabelText('Design annotation'), { target: { value: 'First note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pin' }))

    fireEvent.click(overlay, { clientX: 180, clientY: 90 })
    fireEvent.change(screen.getByLabelText('Design annotation'), { target: { value: 'Second note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pin' }))

    expect(screen.getByText('2 pins')).toBeInTheDocument()
    expect(screen.getByText('First note')).toBeInTheDocument()
    expect(screen.getByText('Second note')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add all to chat' }))
    expect(onAddToChat).toHaveBeenCalledTimes(1)
    expect(onAddToChat).toHaveBeenCalledWith(expect.stringContaining('First note'))
    expect(onAddToChat).toHaveBeenCalledWith(expect.stringContaining('Second note'))

    fireEvent.click(screen.getByRole('button', { name: 'Remove pin 1' }))
    expect(screen.queryByText('First note')).not.toBeInTheDocument()
    expect(screen.getByText('1 pin')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear pins' }))
    expect(screen.queryByText('Second note')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workbench-design-pin-list')).not.toBeInTheDocument()
  })

  it('persists committed pins across a live frame update (a rerender with a new target)', () => {
    const first = { id: 'frame-1', imageUrl: 'https://cdn.example.test/frame-1.png', title: 'Browser frame 1', source: 'event' as const }
    const { rerender } = render(<WorkbenchBrowserPanel targets={[first]} onAddToChat={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Start live stream' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Design Mode' }))

    const overlay = screen.getByLabelText('Design Mode canvas')
    jest.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON: () => ({}),
    })
    fireEvent.click(overlay, { clientX: 50, clientY: 50 })
    fireEvent.change(screen.getByLabelText('Design annotation'), { target: { value: 'Persisted pin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pin' }))
    expect(screen.getByText('Persisted pin')).toBeInTheDocument()

    // Simulate a new live frame arriving — the streamed target list grows and the panel follows the newest frame.
    const second = { id: 'frame-2', imageUrl: 'https://cdn.example.test/frame-2.png', title: 'Browser frame 2', source: 'event' as const }
    rerender(<WorkbenchBrowserPanel targets={[first, second]} onAddToChat={jest.fn()} />)

    expect(screen.getByRole('img', { name: 'Browser frame 2' })).toBeInTheDocument()
    expect(screen.getByText('Persisted pin')).toBeInTheDocument()
    expect(screen.getByText('1 pin')).toBeInTheDocument()

    // A third frame arrives while still streaming — the pin must keep surviving.
    const third = { id: 'frame-3', imageUrl: 'https://cdn.example.test/frame-3.png', title: 'Browser frame 3', source: 'event' as const }
    rerender(<WorkbenchBrowserPanel targets={[first, second, third]} onAddToChat={jest.fn()} />)

    expect(screen.getByRole('img', { name: 'Browser frame 3' })).toBeInTheDocument()
    expect(screen.getByText('Persisted pin')).toBeInTheDocument()
  })

  it('formats Design Mode annotations as bounded plain text', () => {
    expect(formatDesignAnnotation({
      title: 'Pricing page',
      url: 'https://preview.example.test/pricing',
      xPct: 25,
      yPct: 50,
      note: '  Tighten this copy.  ',
    })).toBe('[Design note]\nTarget: Pricing page\nURL: https://preview.example.test/pricing\nPoint: 25%, 50%\nFeedback: Tighten this copy.')
  })
})
