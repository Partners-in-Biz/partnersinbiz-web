import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ContactsBulkCommandBar,
  type BulkActionKey,
} from '@/components/crm/ContactsBulkCommandBar'

const teamMembers = [
  {
    uid: 'uid-1',
    firstName: 'Maya',
    lastName: 'Dlamini',
    jobTitle: 'Growth lead',
    avatarUrl: '',
    role: 'member',
  },
]

describe('ContactsBulkCommandBar', () => {
  it('renders selected-contact analytics and exposes safe bulk actions', () => {
    const onActionChange = jest.fn()
    const onClear = jest.fn()
    const onApply = jest.fn()
    const onDelete = jest.fn()

    render(
      <ContactsBulkCommandBar
        selectedCount={3}
        totalCount={10}
        bulkAction="stage"
        bulkPending={false}
        teamMembers={teamMembers}
        bulkAssignUid=""
        bulkStage="proposal"
        bulkType="lead"
        bulkTagsInput=""
        stages={['new', 'proposal', 'won']}
        types={['lead', 'client']}
        onActionChange={onActionChange}
        onAssignUidChange={jest.fn()}
        onStageChange={jest.fn()}
        onTypeChange={jest.fn()}
        onTagsInputChange={jest.fn()}
        onClear={onClear}
        onApply={onApply}
        onDelete={onDelete}
      />,
    )

    expect(screen.getByText('Bulk command center')).toBeInTheDocument()
    expect(screen.getByText('Selected records')).toBeInTheDocument()
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    expect(screen.getByText('Coverage')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText('Next operation')).toBeInTheDocument()
    expect(screen.getAllByText('Change stage to...').length).toBeGreaterThan(0)
    expect(screen.getByText('Safety')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Bulk action'), {
      target: { value: 'add-tags' satisfies BulkActionKey },
    })
    expect(onActionChange).toHaveBeenCalledWith('add-tags')

    fireEvent.click(screen.getByRole('button', { name: /clear selected contacts/i }))
    expect(onClear).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /delete selected contacts/i }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('renders bulk stage and type options as readable CRM labels', () => {
    const defaultProps = {
      selectedCount: 2,
      totalCount: 8,
      bulkPending: false,
      teamMembers,
      bulkAssignUid: '',
      bulkStage: 'proposal',
      bulkType: 'client',
      bulkTagsInput: '',
      stages: ['new', 'proposal', 'won'],
      types: ['lead', 'client'],
      onActionChange: jest.fn(),
      onAssignUidChange: jest.fn(),
      onStageChange: jest.fn(),
      onTypeChange: jest.fn(),
      onTagsInputChange: jest.fn(),
      onClear: jest.fn(),
      onApply: jest.fn(),
      onDelete: jest.fn(),
    }

    const { rerender } = render(
      <ContactsBulkCommandBar
        {...defaultProps}
        bulkAction="stage"
      />,
    )

    const stageSelect = screen.getByLabelText('Stage') as HTMLSelectElement
    expect(Array.from(stageSelect.options).map((option) => option.text)).toEqual(['New', 'Proposal', 'Won'])
    expect(Array.from(stageSelect.options).map((option) => option.value)).toEqual(['new', 'proposal', 'won'])
    expect(screen.queryByRole('option', { name: 'proposal' })).not.toBeInTheDocument()

    rerender(
      <ContactsBulkCommandBar
        {...defaultProps}
        bulkAction="type"
      />,
    )

    const typeSelect = screen.getByLabelText('Type') as HTMLSelectElement
    expect(Array.from(typeSelect.options).map((option) => option.text)).toEqual(['Lead', 'Client'])
    expect(Array.from(typeSelect.options).map((option) => option.value)).toEqual(['lead', 'client'])
    expect(screen.queryByRole('option', { name: 'client' })).not.toBeInTheDocument()
  })
})
