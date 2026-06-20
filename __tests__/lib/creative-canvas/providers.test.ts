import {
  getCreativeCanvasProvider,
  listCreativeCanvasProviders,
} from '@/lib/creative-canvas/providers'

describe('creative canvas provider registry', () => {
  it('lists V1 providers with risk and approval metadata', () => {
    const providers = listCreativeCanvasProviders()
    expect(providers.map((provider) => provider.key)).toEqual(['manual_upload', 'xai', 'higgsfield', 'agent_task'])
    expect(getCreativeCanvasProvider('higgsfield')).toMatchObject({
      key: 'higgsfield',
      usesExternalCredits: true,
      requiresApprovalBeforeClientVisibility: true,
      ownerAgentId: 'maya',
    })
  })

  it('marks manual upload as a non-credit provider', () => {
    expect(getCreativeCanvasProvider('manual_upload')).toMatchObject({
      key: 'manual_upload',
      usesExternalCredits: false,
      isAsync: false,
      riskLevel: 'low',
    })
  })

  it('returns null for unknown providers', () => {
    expect(getCreativeCanvasProvider('unknown')).toBeNull()
  })
})
