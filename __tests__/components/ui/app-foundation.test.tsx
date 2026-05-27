import { fireEvent, render, screen } from '@testing-library/react'
import {
  AppShell,
  EmptyState,
  PageHeader,
  PageLinkTabs,
  PageTabs,
  ResponsiveHeaderTabs,
  StatusPill,
  Surface,
  DialogDrawer,
} from '@/components/ui/AppFoundation'

describe('app-wide UI foundation primitives', () => {
  it('renders a constrained app shell with responsive header and content regions', () => {
    render(
      <AppShell header={<div>Top nav</div>} sidebar={<nav>Side nav</nav>} data-testid="shell">
        <p>Main content</p>
      </AppShell>,
    )

    expect(screen.getByTestId('shell')).toHaveClass('pib-app-shell')
    expect(screen.getByText('Top nav').closest('[data-slot="app-shell-header"]')).toBeInTheDocument()
    expect(screen.getByText('Side nav').closest('[data-slot="app-shell-sidebar"]')).toHaveClass('hidden', 'md:block')
    expect(screen.getByText('Main content').closest('[data-slot="app-shell-content"]')).toHaveClass('max-w-[1400px]')
  })

  it('standardizes page headers with eyebrow, title, description, meta, actions, and tabs', () => {
    render(
      <PageHeader
        eyebrow="Projects"
        title="Kanban command centre"
        description="Manage delivery across clients."
        meta={<span>Updated now</span>}
        actions={<button type="button">New task</button>}
        tabs={<PageTabs tabs={[{ label: 'Board', value: 'board' }, { label: 'List', value: 'list' }]} value="board" />}
      />,
    )

    expect(screen.getByText('Projects')).toHaveClass('eyebrow')
    expect(screen.getByRole('heading', { name: 'Kanban command centre' })).toHaveClass('pib-page-title')
    expect(screen.getByText('Manage delivery across clients.')).toHaveClass('pib-page-sub')
    expect(screen.getByText('Updated now')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
  })

  it('provides accessible tabs and segmented controls with icon support', () => {
    const onValueChange = jest.fn()
    render(
      <PageTabs
        ariaLabel="View mode"
        value="list"
        onValueChange={onValueChange}
        variant="segmented"
        tabs={[
          { label: 'Board', value: 'board', icon: 'view_kanban' },
          { label: 'List', value: 'list', icon: 'view_list', badge: 3 },
          { label: 'Archive', value: 'archive', disabled: true },
        ]}
      />,
    )

    expect(screen.getByRole('tablist', { name: 'View mode' })).toHaveClass('pib-tabs', 'pib-tabs-segmented')
    expect(screen.getByRole('tab', { name: /List/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('view_list')).toHaveClass('material-symbols-outlined')
    expect(screen.getByText('3')).toHaveClass('pib-tabs-badge')

    fireEvent.click(screen.getByRole('tab', { name: /Board/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Archive' }))

    expect(onValueChange).toHaveBeenCalledWith('board')
    expect(onValueChange).not.toHaveBeenCalledWith('archive')
  })

  it('provides matching link tabs for route-backed filters', () => {
    render(
      <PageLinkTabs
        ariaLabel="Document status filters"
        activeValue="approved"
        tabs={[
          { label: 'All', value: 'all', href: '/admin/documents', icon: 'description', badge: 9 },
          { label: 'Approved', value: 'approved', href: '/admin/documents?status=approved', badge: 2 },
        ]}
      />,
    )

    expect(screen.getByRole('tablist', { name: 'Document status filters' })).toHaveClass('pib-tabs')
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('href', '/admin/documents')
    expect(screen.getByRole('tab', { name: /Approved/ })).toHaveClass('pib-tab-active')
    expect(screen.getByRole('tab', { name: /Approved/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('description')).toHaveClass('material-symbols-outlined')
    expect(screen.getByText('2')).toHaveClass('pib-tabs-badge')
  })

  it('uses one surface primitive for cards, lists, and table containers', () => {
    const { rerender } = render(<Surface variant="card">Card content</Surface>)
    expect(screen.getByText('Card content')).toHaveClass('pib-card')

    rerender(<Surface variant="list" header={<h2>Task list</h2>} footer={<button>More</button>}>Rows</Surface>)
    expect(screen.getByText('Task list').closest('[data-slot="surface-header"]')).toHaveClass('pib-surface-header')
    expect(screen.getByText('Rows')).toHaveClass('pib-surface-body')
    expect(screen.getByText('More').closest('[data-slot="surface-footer"]')).toHaveClass('pib-surface-footer')
    expect(screen.getByText('Rows').closest('section')).toHaveClass('pib-surface', 'pib-surface-list')

    rerender(<Surface variant="table" as="div">Table shell</Surface>)
    const tableBody = screen.getByText('Table shell')
    expect(tableBody).toHaveClass('pib-surface-body')
    expect(tableBody.parentElement).toHaveClass('pib-surface-table')
  })

  it('normalizes empty states and semantic status pills', () => {
    render(
      <>
        <EmptyState icon="inventory_2" title="No tasks yet" description="Create a task to start this board." action={<button>Plan task</button>} />
        <StatusPill tone="success">Done</StatusPill>
        <StatusPill tone="danger" dot>Blocked</StatusPill>
      </>,
    )

    expect(screen.getByText('inventory_2')).toHaveClass('material-symbols-outlined')
    expect(screen.getByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument()
    expect(screen.getByText('Create a task to start this board.')).toHaveClass('pib-empty-state-description')
    expect(screen.getByText('Done')).toHaveClass('pib-pill-success')
    expect(screen.getByText('Blocked')).toHaveClass('pib-pill-danger')
    expect(screen.getByTestId('status-dot')).toHaveClass('pib-status-dot-danger')
  })

  it('standardizes responsive header tabs and dialog/drawer shells', () => {
    render(
      <>
        <ResponsiveHeaderTabs
          title="Project detail"
          tabs={<PageTabs tabs={[{ label: 'Kanban', value: 'kanban' }]} value="kanban" />}
          actions={<button type="button">Add</button>}
        />
        <DialogDrawer open title="Task details" description="Review the latest status." footer={<button>Close</button>} onClose={() => {}}>
          Drawer body
        </DialogDrawer>
      </>,
    )

    expect(screen.getByText('Project detail').closest('[data-slot="responsive-header-tabs"]')).toHaveClass('pib-responsive-header-tabs')
    expect(screen.getByRole('dialog', { name: 'Task details' })).toHaveClass('pib-dialog-drawer')
    expect(screen.getByText('Review the latest status.')).toHaveClass('pib-dialog-description')
    expect(screen.getByText('Drawer body')).toHaveClass('pib-dialog-body')
  })
})
