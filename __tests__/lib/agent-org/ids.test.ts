import {
  logicalOrgNodeId,
  orgNodeDocId,
} from '@/lib/agent-org/types'

describe('org-scoped agent org node ids', () => {
  it('builds composite firestore doc ids per org', () => {
    expect(orgNodeDocId('org-a', 'coordinator')).toBe('org-a__coordinator')
    expect(orgNodeDocId('org-b', 'coordinator')).toBe('org-b__coordinator')
  })

  it('does not double-prefix an already composite id', () => {
    expect(orgNodeDocId('org-a', 'org-a__pip')).toBe('org-a__pip')
  })

  it('prefers the stored logical id field', () => {
    expect(logicalOrgNodeId('org-a', 'org-a__pip', 'pip')).toBe('pip')
    expect(logicalOrgNodeId('org-a', 'org-a__pip')).toBe('pip')
    expect(logicalOrgNodeId('org-a', 'pip')).toBe('pip')
  })
})
