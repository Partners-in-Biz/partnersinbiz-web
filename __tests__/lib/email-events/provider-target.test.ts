import { resolveProviderEventTarget } from '@/lib/email-events/provider-target'

describe('provider event target resolution', () => {
  it('rejects missing tenant ownership and ambiguous provider ids', () => {
    expect(() => resolveProviderEventTarget([{ id: 'm1', data: { orgId: '' } }])).toThrow('tenant ownership')
    expect(() => resolveProviderEventTarget([
      { id: 'm1', data: { orgId: 'org-1' } }, { id: 'm2', data: { orgId: 'org-2' } },
    ])).toThrow('ambiguous')
  })

  it('returns the single tenant-owned message', () => {
    expect(resolveProviderEventTarget([{ id: 'm1', data: { orgId: 'org-1', to: 'a@example.com' } }]))
      .toEqual({ id: 'm1', data: { orgId: 'org-1', to: 'a@example.com' } })
  })
})
