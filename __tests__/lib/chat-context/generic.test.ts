import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'

const mockResolve = jest.fn()

jest.mock('@/lib/context-references/registry', () => ({
  resolveContextReferences: (...args: unknown[]) => mockResolve(...args),
}))

describe('generic chat context adapter', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders server-derived metrics, activity and resolved relationships without exposing a dead action', async () => {
    mockResolve
      .mockResolvedValueOnce([{
        type: 'contact', id: 'contact-1', orgId: 'org-1', label: 'Jane Client', origin: 'manual',
        href: '/admin/crm/contacts/contact-1', summary: 'jane@example.com | status: contacted',
        metadata: {
          relationshipSeeds: [{ type: 'company', id: 'company-1', relation: 'Company' }],
          presentation: {
            metrics: [{ id: 'stage', label: 'Stage', value: 'contacted' }, { id: 'lead-score', label: 'Lead score', value: 72 }],
            activity: [{ id: 'contacted', type: 'running', label: 'Contacted', occurredAt: '2026-07-20T09:00:00.000Z' }],
          },
        },
      }])
      .mockResolvedValueOnce([{
        type: 'company', id: 'company-1', orgId: 'org-1', label: 'Client Co', origin: 'manual', href: '/admin/crm/companies/company-1',
      }])

    const result = await genericChatContextAdapter.resolve({
      kind: 'contact', id: 'contact-1', user: { uid: 'admin-1', role: 'admin', authKind: 'session', activeOrgId: 'org-1' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'stage', value: 'contacted' }),
      expect.objectContaining({ id: 'lead-score', value: 72 }),
    ]))
    expect(result.model.activity).toEqual([expect.objectContaining({ id: 'contacted', label: 'Contacted' })])
    expect(result.model.relationships).toEqual([expect.objectContaining({ kind: 'company', id: 'company-1', label: 'Client Co' })])
    expect(result.model.groups[0].items[0].actions).toBeUndefined()
    expect(result.model.capabilities).toEqual(['open'])
  })
})
