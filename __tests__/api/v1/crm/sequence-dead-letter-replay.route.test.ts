import { NextRequest } from 'next/server'

const mockWithCrmAuth = jest.fn((_role: string, handler: (...args: never[]) => unknown) => handler)
const mockReplay = jest.fn()

jest.mock('@/lib/auth/crm-middleware', () => ({ withCrmAuth: mockWithCrmAuth }))
jest.mock('@/lib/sequences/dead-letter-replay', () => ({
  DeadLetterReplayError: class DeadLetterReplayError extends Error {},
  replaySequenceDeadLetter: (...args: unknown[]) => mockReplay(...args),
}))

it('requires admin auth and passes the authenticated organisation to replay', async () => {
  mockReplay.mockResolvedValue({ enrollmentId: 'enr-1', idempotent: false })
  const { POST } = await import('@/app/api/v1/crm/sequences/[id]/enrollments/[enrollmentId]/replay/route')
  expect(mockWithCrmAuth).toHaveBeenCalledWith('admin', expect.any(Function))

  const actor = { uid: 'u-1', displayName: 'Peet', kind: 'human' }
  const response = await POST(
    new NextRequest('http://localhost/replay', { method: 'POST', headers: { 'Idempotency-Key': 'retry-key-123' } }),
    { orgId: 'org-1', actor },
    { params: Promise.resolve({ id: 'seq-1', enrollmentId: 'enr-1' }) },
  )
  expect(response.status).toBe(200)
  expect(mockReplay).toHaveBeenCalledWith({
    orgId: 'org-1', sequenceId: 'seq-1', enrollmentId: 'enr-1', replayKey: 'retry-key-123', actor,
  })
})
