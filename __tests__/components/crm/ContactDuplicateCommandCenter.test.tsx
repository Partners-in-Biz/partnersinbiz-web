import { fireEvent, render, screen } from '@testing-library/react'
import {
  applyContactMergeToDuplicateGroups,
  ContactDuplicateCommandCenter,
  type DuplicateGroup,
} from '@/components/crm/ContactDuplicateCommandCenter'

const groups: DuplicateGroup[] = [
  {
    reason: 'email',
    contacts: [
      { id: 'winner-1', name: 'Ava Smith', email: 'ava@example.com', company: 'Acme', stage: 'proposal' },
      { id: 'loser-1', name: 'A Smith', email: 'ava@example.com', company: 'Acme', stage: 'new' },
      { id: 'loser-2', name: 'Ava S', email: 'ava@example.com', company: 'Acme South', stage: 'contacted' },
    ],
  },
  {
    reason: 'name',
    contacts: [
      { id: 'winner-2', name: 'Ben Jones', email: 'ben@example.com' },
      { id: 'loser-3', name: 'Ben Jones', email: 'ben.old@example.com' },
    ],
  },
]

describe('ContactDuplicateCommandCenter', () => {
  it('summarises duplicate hygiene and calls merge for the selected winner and next loser', () => {
    const onMerge = jest.fn()

    render(
      <ContactDuplicateCommandCenter
        groups={groups}
        mergingGroup={null}
        onClose={jest.fn()}
        onMerge={onMerge}
      />,
    )

    expect(screen.getByText('Duplicate hygiene')).toBeInTheDocument()
    expect(screen.getByText('2 match groups')).toBeInTheDocument()
    expect(screen.getByText('5 records')).toBeInTheDocument()
    expect(screen.getByText('3 merges queued')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /merge next duplicate/i })[0])

    expect(onMerge).toHaveBeenCalledWith(0, 'winner-1', 'loser-1')
  })

  it('keeps unresolved contacts in a multi-contact duplicate group after one merge', () => {
    expect(applyContactMergeToDuplicateGroups(groups, 0, 'loser-1')).toEqual([
      {
        reason: 'email',
        contacts: [
          { id: 'winner-1', name: 'Ava Smith', email: 'ava@example.com', company: 'Acme', stage: 'proposal' },
          { id: 'loser-2', name: 'Ava S', email: 'ava@example.com', company: 'Acme South', stage: 'contacted' },
        ],
      },
      groups[1],
    ])
  })

  it('removes a resolved duplicate group when only the winner remains', () => {
    expect(applyContactMergeToDuplicateGroups(groups, 1, 'loser-3')).toEqual([groups[0]])
  })
})
