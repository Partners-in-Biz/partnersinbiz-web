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
  it('turns a clean duplicate scan into an operational data hygiene state', () => {
    const onClose = jest.fn()

    render(
      <ContactDuplicateCommandCenter
        groups={[]}
        mergingGroup={null}
        onClose={onClose}
        onMerge={jest.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Contact data is clean' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'No duplicate contacts need review right now. Keep the team moving with clean owner, stage, and follow-up lists.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('0 merge backlog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Return to contacts' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

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
