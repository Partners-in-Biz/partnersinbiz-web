import {
  buildMarketplaceAgentId,
  canConfigureMarketplaceAgent,
  getMarketplaceTemplate,
  isMarketplaceAgentId,
  listMarketplaceSkills,
  listMarketplaceTemplates,
  marketplacePolicyVersionForSkills,
  marketplacePublicSkillsForAgent,
  parseMarketplaceAgentId,
  sanitizeMarketplaceSkills,
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
    expect(pip?.publicSkills).toContain('pib-chat-canvas')
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
    expect(names).toEqual(expect.arrayContaining(['pib-chat-canvas', 'ceo-on-demand-gather']))
    expect(names).not.toContain('client-documents')
    const manifest = buildSkillPackManifest('pip')
    expect(manifest.policyVersion).not.toMatch(/^marketplace-public/)
  })

  it('lists public skills and rejects tenant ops skill selection', () => {
    const listings = listMarketplaceSkills()
    expect(listings.length).toBeGreaterThan(5)
    expect(listings.every((row) => row.tier === 'public')).toBe(true)
    expect(listings.some((row) => row.skillId === 'project-management')).toBe(true)
    expect(listings.some((row) => row.skillId === 'ceo-on-demand-gather')).toBe(false)
    expect(listings.some((row) => row.skillId === 'client-documents')).toBe(false)

    expect(sanitizeMarketplaceSkills([
      'project-management',
      'client-documents',
      'ceo-on-demand-gather',
      'project-management',
      'not-a-skill',
    ])).toEqual(['project-management'])

    const a = marketplacePolicyVersionForSkills(['project-management', 'daily-workflow'])
    const b = marketplacePolicyVersionForSkills(['daily-workflow', 'project-management'])
    const c = marketplacePolicyVersionForSkills(['project-management'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith('marketplace-public-v1+')).toBe(true)
  })

  it('honours marketplace skill overrides in pack builds', () => {
    const agentId = buildMarketplaceAgentId({ templateId: 'maya', scope: 'user', scopeId: 'u-skills' })
    const names = skillNamesForAgent(agentId, { skillNames: ['content-engine', 'client-documents', 'data-analyst'] })
    expect(names).toEqual(['content-engine', 'data-analyst'])
    expect(names).not.toContain('client-documents')
    const manifest = buildSkillPackManifest(agentId, { skillNames: names })
    expect(manifest.skillNames).toEqual(names)
    expect(manifest.policyVersion).toContain('marketplace-public-v1+')
  })

  it('only lets owners/admins configure marketplace instances', () => {
    expect(canConfigureMarketplaceAgent({
      actorUserId: 'member-a',
      orgId: 'org-a',
      role: 'member',
      agent: {
        agentKind: 'marketplace',
        marketplaceTemplateId: 'pip',
        accessScope: 'personal',
        ownerUserId: 'member-a',
        scopeOrgId: 'org-a',
      },
    })).toBe(true)
    expect(canConfigureMarketplaceAgent({
      actorUserId: 'member-b',
      orgId: 'org-a',
      role: 'member',
      agent: {
        agentKind: 'marketplace',
        marketplaceTemplateId: 'pip',
        accessScope: 'personal',
        ownerUserId: 'member-a',
        scopeOrgId: 'org-a',
      },
    })).toBe(false)
  })
})
