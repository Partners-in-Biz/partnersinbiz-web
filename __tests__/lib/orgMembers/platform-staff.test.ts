import {
  grantedAgentIdsFromPolicy,
  mergeAgentRuntimeAccess,
} from '@/lib/orgMembers/platform-staff'
import type { MemberAccessPolicy } from '@/lib/orgMembers/access-policy'

const mockLoadOrgMemberAccessPolicy = jest.fn()
const mockMemberGet = jest.fn()

jest.mock('@/lib/orgMembers/org-access-policy', () => ({
  loadOrgMemberAccessPolicy: (...args: unknown[]) => mockLoadOrgMemberAccessPolicy(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        get: () => mockMemberGet(id),
      }),
    }),
  },
}))

function policy(overrides: Partial<MemberAccessPolicy> = {}): MemberAccessPolicy {
  return {
    preset: 'custom',
    modules: {
      crm: true,
      projects: true,
      documents: true,
      marketing: true,
      messages: true,
      email: false,
      reports: false,
      research: false,
      properties: false,
      billing: true,
      mobileApps: false,
      youtubeStudio: false,
      bookStudio: false,
      configuration: false,
    },
    recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
    capabilities: { invoices: true, quotes: true },
    agentRuntimeAccess: {},
    allowPersonalLlmOnOrgVps: false,
    ...overrides,
  }
}

describe('platform staff agent policy', () => {
  it('unions specialist grants from conversation and PiB membership', () => {
    expect(mergeAgentRuntimeAccess(
      { 'vps:client': ['pip'] },
      { 'vps:pib': ['nora', 'sales'], 'vps:client': ['docs'] },
    )).toEqual({
      'vps:client': expect.arrayContaining(['pip', 'docs']),
      'vps:pib': ['nora', 'sales'],
    })
  })

  it('lists granted specialists across every computer', () => {
    expect(grantedAgentIdsFromPolicy(policy({
      agentRuntimeAccess: {
        'vps:a': ['pip', 'nora'],
        'vps:b': ['sales', 'docs', 'theo'],
      },
    })).sort()).toEqual(['docs', 'nora', 'pip', 'sales', 'theo'])
  })

  it('merges PiB specialist grants onto a client-org member policy', async () => {
    mockLoadOrgMemberAccessPolicy.mockResolvedValue(policy({
      agentRuntimeAccess: { 'vps:elemental': ['pip'] },
    }))
    mockMemberGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'active',
        role: 'member',
        accessPolicy: policy({
          agentRuntimeAccess: { 'vps:pib': ['nora', 'sales', 'docs', 'theo'] },
        }),
      }),
    })

    const { loadEffectiveMemberAgentPolicy } = await import('@/lib/orgMembers/platform-staff')
    const merged = await loadEffectiveMemberAgentPolicy('wS5pgwa6c9WbPocf4w0w', 'stean')
    expect(merged?.agentRuntimeAccess['vps:elemental']).toEqual(['pip'])
    expect(merged?.agentRuntimeAccess['vps:pib']).toEqual(expect.arrayContaining(['nora', 'sales', 'docs', 'theo']))
  })
})
