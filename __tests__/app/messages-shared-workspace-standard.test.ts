import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

describe('messages shared workspace standard', () => {
  it('keeps portal messages on shared chat and top-level admin messages on governance controls', () => {
    const sharedWorkspacePath = path.join(root, 'components/messages/MessagesWorkspace.tsx')
    const adminRoute = source('app/(admin)/admin/org/[slug]/messages/page.tsx')
    const adminGovernance = source('components/messages/AdminMessagesGovernanceWorkspace.tsx')
    const sharedPolicyControls = source('components/admin-governance/OrganizationModulePolicyControls.tsx')
    const portalRoute = source('app/(portal)/portal/messages/page.tsx')

    expect(existsSync(sharedWorkspacePath)).toBe(true)
    expect(source('components/messages/MessagesWorkspace.tsx')).toContain('export function MessagesWorkspace')

    expect(adminRoute).toContain('@/components/messages/AdminMessagesGovernanceWorkspace')
    expect(adminRoute).toContain('<AdminMessagesGovernanceWorkspace')
    expect(adminRoute).toContain('@/components/messages/MessagesWorkspace')
    expect(adminRoute).toContain('shouldOpenConversationWorkspace')
    expect(adminRoute).toContain('surface="admin"')
    expect(adminGovernance).toContain('Messages governance')
    expect(adminGovernance).toContain('Who can use Messages')
    expect(adminGovernance).toContain('Default message areas plus organisation controls')
    expect(adminGovernance).toContain('What conversation owners control inside a thread')
    expect(adminGovernance).toContain('OrganizationModulePolicyRoleGrid')
    expect(sharedPolicyControls).toContain('Owner')
    expect(sharedPolicyControls).toContain('Admin')
    expect(sharedPolicyControls).toContain('Member')
    expect(portalRoute).toContain('@/components/messages/MessagesWorkspace')
    expect(portalRoute).toContain('surface="portal"')

    expect(adminRoute).not.toContain("import MessagesClient from './MessagesClient'")
    expect(existsSync(path.join(root, 'app/(admin)/admin/org/[slug]/messages/MessagesClient.tsx'))).toBe(false)

    for (const route of [adminRoute, portalRoute]) {
      expect(route).not.toContain("import UnifiedChat from '@/components/chat/UnifiedChat'")
      expect(route).not.toContain("import AgentRunSession from '@/components/agents/AgentRunSession'")
      expect(route).not.toContain('data-testid="portal-messages-workspace"')
      expect(route).not.toContain('data-testid="portal-messages-intro"')
    }
  })
})
