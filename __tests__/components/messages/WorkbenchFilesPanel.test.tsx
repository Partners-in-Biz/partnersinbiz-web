import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkbenchFilesPanel } from '@/components/messages/workbench/WorkbenchFilesPanel'

const tree = [{ name: 'app.ts', path: 'src/app.ts', kind: 'file' as const }]

describe('WorkbenchFilesPanel Phase 2', () => {
  it('requests a live directory listing when a folder is expanded', () => {
    const onExpandDirectory = jest.fn()
    render(<WorkbenchFilesPanel
      tree={[{ name: 'src', path: 'src', kind: 'directory' }]}
      onExpandDirectory={onExpandDirectory}
    />)
    fireEvent.click(screen.getByText('src'))
    expect(onExpandDirectory).toHaveBeenCalledWith('src')
  })

  it('renders a syntax-highlighted text preview with the detected language', () => {
    render(<WorkbenchFilesPanel
      tree={tree}
      selectedPath="src/app.ts"
      preview={{ path: 'src/app.ts', content: 'const answer = "yes"', sha256: 'a'.repeat(64), loading: false, error: null }}
    />)

    expect(screen.getByTestId('workbench-syntax-preview')).toHaveAttribute('data-language', 'typescript')
    expect(screen.getByText(/const answer/)).toBeInTheDocument()
  })

  it('requires an explicit Approve & save action before invoking the gated write callback', async () => {
    const onSave = jest.fn(async () => ({ sha256: 'b'.repeat(64) }))
    render(<WorkbenchFilesPanel
      tree={tree}
      selectedPath="src/app.ts"
      preview={{ path: 'src/app.ts', content: 'old', sha256: 'a'.repeat(64), loading: false, error: null }}
      onSave={onSave}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit file' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'File contents' }), { target: { value: 'new' } })
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Approve & save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('src/app.ts', 'new', 'a'.repeat(64)))
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('shows the linked-computer failure instead of presenting it as an empty folder', () => {
    render(<WorkbenchFilesPanel tree={[]} message="Computer runtime update required for Workbench" />)

    expect(screen.getByText('Files could not be loaded')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Computer runtime update required for Workbench')
    expect(screen.queryByText('No files found')).not.toBeInTheDocument()
  })
})
