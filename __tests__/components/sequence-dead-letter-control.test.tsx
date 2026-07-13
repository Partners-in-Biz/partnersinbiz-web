import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SequenceDeadLetterControl from '@/components/email/SequenceDeadLetterControl'

it('shows failed enrollments and requeues one with an idempotency key', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { enrollments: [{ id: 'enr-1', contactId: 'contact-1', status: 'dead_letter', deadLetter: { reason: 'Twilio unavailable', attempts: 5 } }] } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { enrollmentId: 'enr-1', idempotent: false } }) })
  global.fetch = fetchMock as never

  render(<SequenceDeadLetterControl sequenceId="seq-1" endpoint={(path) => `/scoped${path}`} />)
  expect(await screen.findByText(/Twilio unavailable/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Retry contact-1/i }))

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock.mock.calls[1][0]).toBe('/scoped/api/v1/crm/sequences/seq-1/enrollments/enr-1/replay')
  expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
    method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
  }))
  await waitFor(() => expect(screen.queryByText(/Twilio unavailable/)).not.toBeInTheDocument())
})
