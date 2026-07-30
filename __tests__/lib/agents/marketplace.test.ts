import {
  buildMarketplaceAgentId,
  getMarketplaceTemplate,
  isMarketplaceAgentId,
  listMarketplaceTemplates,
  marketplacePublicSkillsForAgent,
  parseMarketplaceAgentId,
} from '@/lib/agents/marketplace'
import { buildSkillPackManifest, skillNamesForAgent } from '@/lib/agents/skill-pack-builder'

describe('agent marketplace catalog', () => {
  it('lists published templates with public personas and skills', () => {
    const templates = listMarketplaceTemplates()
    expect(templates.length).toBeGreaterThanOrEqual(8)
    const pip = getMarketplaceTemplate('pip')
    expect(pip?.name).toBe('Pip')
    expect(pip?.publicPersona.toLowerCase()).toContain('do not assume partners in biz')
    expect(pip?.publicSkills).toContain('project-management')
    expect(pip?.publicSkills).not.toContain('ceo-on-demand-gather')
    expect(pip?.publicSkills).not.toContain('client-documents')
  })

  it('builds stable marketplace instance ids that never collide with platform pip', () => {
    const a = buildMarketplaceAgentId({ templateId: 'pip', scope: 'user', scopeId: 'user-1' })
    const b = buildMarketplaceAgentId({ templateId: 'pip', scope: 'user', scopeId: 'user-1' })
    const c = buildMarketplaceAgentId({ templateId: 'pip', scope: 'user', scopeId: 'user-2' })
    const org = buildMarketplaceAgentId({ templateId: 'qa-release', scope: 'org', scopeId: 'org-a' })

    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe('pip')
    expect(a.startsWith('mp-pip-')).toBe(true)
    expect(isMarketplaceAgentId(a)).toBe(true)
    expect(isMarketplaceAgentId('pip')).toBe(false)
    expect(parseMarketplaceAgentId(org)).toEqual({
      templateId: 'qa-release',
      scopeKey: expect.stringMatching(/^[a-f0-9]{12}$/),
    })
  })

  it('ships public skill packs for marketplace instances without PiB ops skills', () => {
    const agentId = buildMarketplaceAgentId({ templateId: 'pip', scope: 'org', scopeId: 'org-marketplace' })
    const names = skillNamesForAgent(agentId)
    expect(names.length).toBeGreaterThan(0)
    expect(names).toEqual(expect.arrayContaining(['project-management', 'collaboration-runtime']))
    expect(names).not.toEqual(expect.arrayContaining([
      'ceo-on-demand-gather',
      'client-documents',
      'crm-sales',
      'agent-runtime-gather',
    ]))

    const manifest = buildSkillPackManifest(agentId)
    expect(manifest.policyVersion).toMatch(/^marketplace-public/)
    expect(manifest.skillNames).toEqual(names)
    // Files should resolve for skills that exist in the pack root
    expect(manifest.files.length).toBeGreaterThan(0)
    expect([...marketplacePublicSkillsForAgent(agentId)].sort()).toEqual(names)
  })

  it('keeps full PiB skill policy for platform pip', () => {
    const names = skillNamesForAgent('pip')
    expect(names).toEqual(expect.arrayContaining(['client-documents', 'ceo-on-demand-gather']))
    const manifest = buildSkillPackManifest('pip')
    expect(manifest.policyVersion).not.toMatch(/^marketplace-public/)
  })
})
