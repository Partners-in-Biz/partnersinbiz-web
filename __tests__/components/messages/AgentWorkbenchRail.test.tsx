import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import AgentWorkbenchRail from '@/components/messages/workbench/AgentWorkbenchRail'
import { WorkbenchBrowserPanel } from '@/components/messages/workbench/WorkbenchBrowserPanel'
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
    expect(screen.queryByRole('link', { name: 'Open observed URL' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Observed preview'))
    expect(screen.queryByRole('link', { name: 'Open observed URL' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(screen.getByRole('link', { name: 'Open observed URL' })).toHaveAttribute('href', 'https://public-preview.example.test/app')
    expect(screen.getByRole('link', { name: 'Open observed URL' })).toHaveAttribute('rel', 'noopener noreferrer')
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
    'http://198.51.100.10',
  ])('blocks non-public and reserved target %s', (url) => {
    render(<WorkbenchBrowserPanel targets={[]} />)
    fireEvent.change(screen.getByLabelText('Browser target URL'), { target: { value: url } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/private-network/)
    expect(screen.queryByRole('link', { name: 'Open observed URL' })).not.toBeInTheDocument()
  })
})
