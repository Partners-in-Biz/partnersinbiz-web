import {
  probeVpsPlatformProfiles,
  resetVpsHostedProfileCache,
  resolveHostedAgentIds,
  vpsPublicHealthUrl,
} from '@/lib/linked-computers/hosted-agents'

describe('resolveHostedAgentIds', () => {
  it('keeps Mac platform agents from heartbeat and custom agents only when credential-ready', () => {
    expect(resolveHostedAgentIds({
      deviceKind: 'computer',
      availableAgentIds: ['theo', 'blake', 'site-bot'],
      credentialReadyAgentIds: ['blake'],
    })).toEqual(['blake', 'theo'])
  })

  it('drops VPS platform agents whose public profile is missing', () => {
    expect(resolveHostedAgentIds({
      deviceKind: 'vps',
      availableAgentIds: ['pip', 'theo', 'blake', 'finance'],
      credentialReadyAgentIds: ['blake'],
      desiredAgentIds: ['people'],
      vpsProfileStatus: {
        pip: 'hosted',
        theo: 'hosted',
        finance: 'missing',
        people: 'missing',
      },
    })).toEqual(['blake', 'pip', 'theo'])
  })

  it('includes live-hosted VPS specialists even when heartbeat omitted them', () => {
    expect(resolveHostedAgentIds({
      deviceKind: 'vps',
      availableAgentIds: ['blake'],
      credentialReadyAgentIds: ['blake'],
      vpsProfileStatus: { pip: 'hosted', nora: 'hosted', finance: 'missing' },
    })).toEqual(['blake', 'nora', 'pip'])
  })

  it('does not treat desired-only custom agents as hosted', () => {
    expect(resolveHostedAgentIds({
      deviceKind: 'computer',
      availableAgentIds: ['theo'],
      credentialReadyAgentIds: [],
      desiredAgentIds: ['custom-bot'],
    })).toEqual(['theo'])
  })
})

describe('probeVpsPlatformProfiles', () => {
  afterEach(() => {
    resetVpsHostedProfileCache()
  })

  it('marks 404 as missing and other HTTP as hosted, then caches', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      const missing = String(url).includes('/profiles/finance/')
      return { status: missing ? 404 : 200 } as Response
    })
    const first = await probeVpsPlatformProfiles({
      agentIds: ['pip', 'finance'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => 1_000,
      ttlMs: 10_000,
    })
    expect(first).toEqual({ pip: 'hosted', finance: 'missing' })
    expect(vpsPublicHealthUrl('pip')).toContain('/profiles/pip/v1/health')

    const second = await probeVpsPlatformProfiles({
      agentIds: ['pip', 'finance'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => 2_000,
      ttlMs: 10_000,
    })
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
