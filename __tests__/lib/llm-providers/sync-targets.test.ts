/**
 * @jest-environment node
 */

const mockGetHermesProfileLink = jest.fn()
const mockLinkedDevicesGet = jest.fn()

jest.mock('@/lib/hermes/server', () => ({
  getHermesProfileLink: (...args: unknown[]) => mockGetHermesProfileLink(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({ get: (...args: unknown[]) => mockLinkedDevicesGet(...args) }),
    }),
  },
}))

import { resolveOrgLlmSyncTargets } from '@/lib/llm-providers/sync-targets'

function deviceDoc(id: string, availableAgentIds: string[]) {
  return {
    id,
    data: () => ({
      deviceKind: 'vps',
      ownerType: 'organization',
      ownerOrgId: 'org-1',
      runtimeTargetId: `linked-device:${id}`,
      status: 'active',
      label: 'Shared VPS',
      availableAgentIds,
    }),
  }
}

describe('organisation LLM sync targets', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetHermesProfileLink.mockResolvedValue({
      enabled: true,
      baseUrl: 'https://vps.example',
      apiKey: 'secret',
      profile: 'pip',
    })
  })

  it('uses the linked VPS target instead of duplicating its legacy profile link', async () => {
    mockLinkedDevicesGet.mockResolvedValue({ docs: [deviceDoc('vps-1', ['pip', 'theo'])] })

    const result = await resolveOrgLlmSyncTargets('org-1')

    expect(result.targets.map((target) => [target.kind, target.agentId])).toEqual([
      ['org_linked_vps', 'pip'],
      ['org_linked_vps', 'theo'],
    ])
  })

  it('retains a legacy profile link when no linked VPS covers that profile', async () => {
    mockLinkedDevicesGet.mockResolvedValue({ docs: [deviceDoc('vps-1', ['theo'])] })

    const result = await resolveOrgLlmSyncTargets('org-1')

    expect(result.targets.map((target) => [target.kind, target.agentId])).toEqual([
      ['org_hermes_link', 'pip'],
      ['org_linked_vps', 'theo'],
    ])
  })
})
