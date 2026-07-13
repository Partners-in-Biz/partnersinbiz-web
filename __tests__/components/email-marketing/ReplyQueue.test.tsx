/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReplyQueue } from '@/components/email-marketing/ReplyQueue'

it('loads the next stable reply page and appends it without replacing the queue', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [{ id: 'r1', subject: 'First', classification: 'neutral', modelClassification: 'neutral', slaState: 'due' }], nextCursor: 'cursor-1' } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [{ id: 'r2', subject: 'Second', classification: 'positive', modelClassification: 'positive', slaState: 'due' }], nextCursor: null } }) })
  global.fetch = fetchMock as typeof fetch
  render(<ReplyQueue scope={{ orgId: 'org-1' }} />)
  await screen.findAllByText('First')
  fireEvent.click(screen.getByRole('button', { name: 'Load more replies' }))
  await screen.findByText('Second')
  expect(screen.getAllByText('First').length).toBeGreaterThan(0)
  expect(fetchMock.mock.calls[1][0]).toContain('cursor=cursor-1')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more replies' })).not.toBeInTheDocument())
})
