import { creativeProviderConnectionId } from '@/lib/creative-canvas/connections/types'

describe('creativeProviderConnectionId', () => {
  it('builds deterministic org-scoped ids', () => {
    expect(creativeProviderConnectionId({ provider: 'xai', scope: 'org', orgId: 'org-1', ownerUid: null }))
      .toBe('org:org-1:xai')
  })
  it('builds deterministic user-scoped ids independent of org', () => {
    expect(creativeProviderConnectionId({ provider: 'recraft', scope: 'user', orgId: 'org-1', ownerUid: 'uid-9' }))
      .toBe('user:uid-9:recraft')
  })
  it('throws when user scope is missing ownerUid', () => {
    expect(() => creativeProviderConnectionId({ provider: 'xai', scope: 'user', orgId: 'org-1', ownerUid: null }))
      .toThrow('ownerUid is required')
  })
})
