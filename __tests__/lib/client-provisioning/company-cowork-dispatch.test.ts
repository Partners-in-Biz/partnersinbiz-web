import {
  conversationUsesCompanyCoworkFolder,
  linkedCoworkWorkingDirectory,
  linkedRuntimeSupportsCoworkWorkingDirectory,
} from '@/lib/client-provisioning/company-cowork-dispatch'
import type { ConversationWorkspaceContext } from '@/lib/client-provisioning/workspace-context'

function context(overrides: Partial<ConversationWorkspaceContext> = {}): ConversationWorkspaceContext {
  return {
    workspaceId: 'partners',
    orgId: 'org-1',
    orgSlug: 'partners',
    orgName: 'Partners in Biz',
    agentDomain: 'partners',
    vpsPath: '/var/lib/hermes/Cowork/Partners in Biz',
    localPath: '/Users/peet/Cowork/Partners in Biz',
    agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/partners',
    localAgentDomainPath: '/Users/peet/Cowork/Cowork/agents/partners',
    sourceOfTruth: 'vps',
    runtimeTarget: 'linked-device:mac',
    runtimeLabel: 'Mac',
    shareMode: 'private',
    ownerUserId: 'user-1',
    companyId: null,
    contactIds: [],
    ...overrides,
  }
}

describe('company cowork dispatch helpers', () => {
  it('detects company-root and company-project folders', () => {
    expect(conversationUsesCompanyCoworkFolder(context({ folderScope: 'organisation' }))).toBe(false)
    expect(conversationUsesCompanyCoworkFolder(context({
      folderScope: 'company',
      companyId: 'c1',
      companyWorkspaceId: 'hunt',
    }))).toBe(true)
    expect(conversationUsesCompanyCoworkFolder(context({
      folderScope: 'project',
      projectId: 'p1',
      companyWorkspaceId: 'hunt',
    }))).toBe(true)
  })

  it('returns the company local working directory for linked dispatch', () => {
    expect(linkedCoworkWorkingDirectory(context({
      folderScope: 'company',
      companyId: 'c1',
      localWorkingPath: '/Users/peet/Cowork/Hunt and Gun',
    }))).toBe('/Users/peet/Cowork/Hunt and Gun')
    expect(linkedCoworkWorkingDirectory(context({ folderScope: 'organisation' }))).toBeUndefined()
  })

  it('requires linked runtime 1.1.3+ for company workingDirectory', () => {
    expect(linkedRuntimeSupportsCoworkWorkingDirectory('1.1.2')).toBe(false)
    expect(linkedRuntimeSupportsCoworkWorkingDirectory('1.1.3')).toBe(true)
    expect(linkedRuntimeSupportsCoworkWorkingDirectory('1.2.0')).toBe(true)
  })
})
