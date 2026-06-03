import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SavedViewsBar } from '@/components/crm/SavedViewsBar'

const viewsResponse = {
  data: {
    views: [
      {
        id: 'view-hot',
        name: 'Hot proposal leads',
        filters: { stage: 'proposal', type: 'lead' },
      },
      {
        id: 'view-clients',
        name: 'Active clients',
        filters: { type: 'client' },
      },
    ],
  },
}

describe('SavedViewsBar', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => viewsResponse,
    } as Response) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('turns an empty saved-view list into a guided lens setup state', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { views: [] } }),
    } as Response)

    render(
      <SavedViewsBar
        currentFilters={{ search: 'retainer', stage: 'proposal', followUp: 'stale' }}
        onSelectView={jest.fn()}
        resourceKind="contacts"
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Create the first reusable contact lens' })).toBeInTheDocument()
    expect(
      screen.getByText('Save this filtered contact list so every employee can reopen the same owner, stage, or follow-up view without rebuilding it.'),
    ).toBeInTheDocument()
    expect(screen.getByText('3 active filters ready to save')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save this working list' }))

    expect(screen.getByPlaceholderText('View name')).toHaveFocus()
  })

  it('renders a saved-view command center with filter counts and selectable views', async () => {
    const onSelectView = jest.fn()

    render(
      <SavedViewsBar
        currentFilters={{ search: 'acme', stage: 'proposal', type: '' }}
        onSelectView={onSelectView}
        resourceKind="contacts"
      />,
    )

    expect(await screen.findByText('Saved view command center')).toBeInTheDocument()
    expect(screen.getByText('Saved views')).toBeInTheDocument()
    expect(screen.getByText('Current lens')).toBeInTheDocument()
    expect(screen.getByText('Active filters')).toBeInTheDocument()
    expect(screen.getAllByText('2 filters').length).toBeGreaterThan(0)
    expect(await screen.findByText('Hot proposal leads')).toBeInTheDocument()
    expect(screen.getByText('Active clients')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save current view/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /apply saved view hot proposal leads/i }))

    await waitFor(() => {
      expect(onSelectView).toHaveBeenCalledWith({ stage: 'proposal', type: 'lead' })
    })
  })

  it('uses an in-page confirmation before deleting a saved CRM view', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <SavedViewsBar
        currentFilters={{ stage: 'proposal' }}
        onSelectView={jest.fn()}
        resourceKind="contacts"
      />,
    )

    expect(await screen.findByText('Hot proposal leads')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete saved view Hot proposal leads' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Delete saved view "Hot proposal leads"?' })).toBeInTheDocument()
    expect(screen.getByText('This removes the shared CRM lens for everyone using the contacts workspace.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/saved-views/view-hot', expect.any(Object))
    expect(screen.getByRole('button', { name: 'Cancel delete for saved view Hot proposal leads' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete saved view Hot proposal leads' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/saved-views/view-hot', { method: 'DELETE' })
    })

    confirmSpy.mockRestore()
  })
})
