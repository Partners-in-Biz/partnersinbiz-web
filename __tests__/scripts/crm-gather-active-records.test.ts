import { activeRows, emailDuplicateGroups } from '@/scripts/crm-gather-active-records'

describe('CRM gather active-record helpers', () => {
  it('excludes soft-deleted rows before counting hygiene gaps and duplicates', () => {
    const contacts = [
      { id: 'active-a', email: 'owner@example.com', deleted: false },
      { id: 'active-b', email: 'owner@example.com' },
      { id: 'deleted-c', email: 'owner@example.com', deleted: true },
      { id: 'deleted-only-a', email: 'merged@example.com', deleted: true },
      { id: 'deleted-only-b', email: 'merged@example.com', deleted: true },
    ]

    const active = activeRows(contacts)
    const duplicates = emailDuplicateGroups(active)

    expect(active.map((row) => row.id)).toEqual(['active-a', 'active-b'])
    expect(duplicates).toEqual([
      {
        email: 'owner@example.com',
        count: 2,
        ids: ['active-a', 'active-b'],
        names: [],
      },
    ])
  })
})
