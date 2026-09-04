import {
  resolveCreatedAgentAccess,
  withGrantedAgentOnRuntime,
} from '@/lib/orgMembers/agent-runtime-grants'
import { normalizeMemberAccessPolicy } from '@/lib/orgMembers/access-policy'

describe('resolveCreatedAgentAccess', () => {
  it('keeps personal agents on a user-owned computer unless sharing is requested', () => {
    expect(resolveCreatedAgentAccess({ deviceAccessScope: 'personal', requested: 'personal' }))
      .toEqual({ accessScope: 'personal', grantMembers: false })
    expect(resolveCreatedAgentAccess({ deviceAccessScope: 'personal', requested: 'people' }))
      .toEqual({ accessScope: 'organization', grantMembers: true })
  })

  it('cannot make an organisation VPS agent personal', () => {
    expect(resolveCreatedAgentAccess({ deviceAccessScope: 'organization', requested: 'personal' }))
      .toEqual({ accessScope: 'organization', grantMembers: false })
  })
})

describe('withGrantedAgentOnRuntime', () => {
  it('writes the agent onto both linked-device grant keys', () => {
    const next = withGrantedAgentOnRuntime(
      normalizeMemberAccessPolicy({ agentRuntimeAccess: { 'linked-device:mac-1': ['pip'] } }),
      'linked-device:mac-1',
      'oa-research',
    )
    expect(next.agentRuntimeAccess['linked-device:mac-1']).toEqual(['pip', 'oa-research'])
    expect(next.agentRuntimeAccess['mac-1']).toEqual(['oa-research'])
  })

  it('does not duplicate an existing grant', () => {
    const next = withGrantedAgentOnRuntime(
      { agentRuntimeAccess: { 'linked-device:mac-1': ['pip'] } },
      'linked-device:mac-1',
      'pip',
    )
    expect(next.agentRuntimeAccess['linked-device:mac-1']).toEqual(['pip'])
  })
})
