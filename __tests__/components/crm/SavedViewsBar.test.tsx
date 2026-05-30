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
})
