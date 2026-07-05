import { connectionScopeKey, creativeProviderConnectionId } from '@/lib/creative-canvas/connections/types'

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

describe('connectionScopeKey', () => {
  it('prefixes org scope keys', () => {
    expect(connectionScopeKey({ scope: 'org', orgId: 'org-1', ownerUid: null })).toBe('org:org-1')
  })
  it('prefixes user scope keys', () => {
    expect(connectionScopeKey({ scope: 'user', orgId: 'org-1', ownerUid: 'uid-9' })).toBe('user:uid-9')
  })
  it('an orgId shaped like a user key cannot collide with a real user scope', () => {
    expect(connectionScopeKey({ scope: 'org', orgId: 'user:uid-9', ownerUid: null }))
      .not.toBe(connectionScopeKey({ scope: 'user', orgId: 'anything', ownerUid: 'uid-9' }))
  })
  it('throws for user scope without ownerUid', () => {
    expect(() => connectionScopeKey({ scope: 'user', orgId: 'org-1', ownerUid: null })).toThrow('ownerUid is required')
  })
})
