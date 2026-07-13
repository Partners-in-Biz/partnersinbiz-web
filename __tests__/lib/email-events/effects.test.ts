import { applyVariantProjectionEffect } from '@/lib/email-events/effects'

it('atomically increments a variant once across provider event replay', async () => {
  const rows = new Map<string, Record<string, unknown>>([['broadcasts/b1', { ab: { variants: [{ id: 'v1' }] } }]])
  const updates: unknown[] = []
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ({ id: `${name}/${id}` }) }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: async (ref: { id: string }) => ({ exists: rows.has(ref.id), data: () => rows.get(ref.id) }),
      update: (ref: { id: string }, value: unknown) => updates.push([ref.id, value]),
      create: (ref: { id: string }, value: Record<string, unknown>) => rows.set(ref.id, value),
    }),
  }
  const input = { eventId: 'e1', targetCollection: 'broadcasts' as const, targetId: 'b1', variantId: 'v1', field: 'opened' as const, db: db as never }
  expect(await applyVariantProjectionEffect(input)).toBe(true)
  expect(await applyVariantProjectionEffect(input)).toBe(false)
  expect(updates).toHaveLength(1)
})
