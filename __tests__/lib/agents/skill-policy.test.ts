import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_SKILL_POLICY,
  buildAgentSkillPolicyState,
  computeAgentSkillDrift,
  listCatalogSkillPaths,
  listSyncableRepoSkillPaths,
  withAgentPolicyExternalDir,
} from '@/lib/agents/skill-policy'

describe('agent skill policy manifest', () => {
  function discoverRepoSkills(dir = join(process.cwd(), '.claude/skills'), prefix = ''): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (!statSync(full).isDirectory()) continue
      const rel = prefix ? `${prefix}/${entry}` : entry
      if (existsSync(join(full, 'SKILL.md'))) found.push(rel)
      found.push(...discoverRepoSkills(full, rel))
    }
    return found.sort()
  }

  it('tracks every top-level PiB platform skill that must sync to the VPS cache', () => {
    expect(AGENT_SKILL_POLICY.repoPibSkills).toEqual([
      'ads-manager',
      'analytics',
      'billing-finance',
      'collaboration-runtime',
      'client-documents',
      'client-manager',
      'content-engine',
      'crm-sales',
      'data-analyst',
      'docs-lead',
      'email-outreach',
      'evidence-ledger',
      'geo-seo-service',
      'google-workspace',
      'platform-ops',
      'project-management',
      'qa-release',
      'properties',
      'research-intelligence',
      'seo-sprint-manager',
      'social-media-manager',
      'support-manager',
    ])

    for (const skill of AGENT_SKILL_POLICY.repoPibSkills) {
      expect(existsSync(join(process.cwd(), '.claude/skills', skill, 'SKILL.md'))).toBe(true)
    }
  })

  it('catalogs every repo skill folder with an owner and runtime policy', () => {
    const discovered = discoverRepoSkills()
    expect(discovered.length).toBeGreaterThanOrEqual(45)
    expect(listCatalogSkillPaths()).toEqual(discovered)
    expect(listSyncableRepoSkillPaths()).toEqual(discovered)

    for (const skillPath of discovered) {
      const entry = AGENT_SKILL_POLICY.skillCatalog[skillPath]
      expect(entry).toEqual(expect.objectContaining({
        ownerAgentId: expect.any(String),
        riskLevel: expect.stringMatching(/^(low|medium|high|critical)$/),
        syncTarget: 'vps',
      }))
      expect(entry.allowedAgentIds.length).toBeGreaterThan(0)
      for (const agentId of [entry.ownerAgentId, ...entry.allowedAgentIds]) {
        expect(AGENT_SKILL_POLICY.agents[agentId]).toBeTruthy()
      }
    }
  })

  it('keeps agent policies constrained to known repo skills and profile-specific dirs', () => {
    const known = new Set(AGENT_SKILL_POLICY.repoPibSkills)

    for (const [agentId, policy] of Object.entries(AGENT_SKILL_POLICY.agents)) {
      expect(policy.vpsExternalDir).toBe(`/var/lib/hermes/agent-skills/${agentId}`)
      expect(policy.pibSkills.length).toBeGreaterThan(0)
      for (const skill of policy.pibSkills) expect(known.has(skill)).toBe(true)
      expect(policy.runtimeSkills.length).toBeGreaterThanOrEqual(policy.pibSkills.length)
      for (const skill of policy.runtimeSkills) {
        expect(AGENT_SKILL_POLICY.skillCatalog[skill]).toBeTruthy()
      }
    }
  })

  it('assigns specialists for ads, QA, support, data, docs, and SEO', () => {
    expect(Object.keys(AGENT_SKILL_POLICY.agents).sort()).toEqual([
      'ads',
      'data',
      'docs',
      'maya',
      'nora',
      'pip',
      'qa-release',
      'sage',
      'sales',
      'seo',
      'support',
      'theo',
    ])
    expect(AGENT_SKILL_POLICY.agents.ads.name).toBe('Ari')
    expect(AGENT_SKILL_POLICY.agents['qa-release'].name).toBe('Quinn')
    expect(AGENT_SKILL_POLICY.agents.support.name).toBe('Luca')
    expect(AGENT_SKILL_POLICY.agents.data.name).toBe('Vera')
    expect(AGENT_SKILL_POLICY.agents.docs.name).toBe('Iris')
    expect(AGENT_SKILL_POLICY.agents.seo.name).toBe('Silas')
  })

  it('assigns Theo the engineering workflow while moving dedicated SEO and ads packs to specialists', () => {
    expect(AGENT_SKILL_POLICY.agents.theo.runtimeSkills).toEqual(expect.arrayContaining([
      'software-development/plan',
      'software-development/test-driven-development',
      'software-development/systematic-debugging',
      'software-development/writing-plans',
    ]))
    expect(AGENT_SKILL_POLICY.agents.seo.runtimeSkills).toEqual(expect.arrayContaining([
      'seo-sprint-manager',
      'marketing/local-seo-system',
    ]))
    expect(AGENT_SKILL_POLICY.agents.ads.runtimeSkills).toEqual(expect.arrayContaining([
      'ads-manager',
      'marketing/ads',
      'marketing/ads-google',
      'marketing/ads-meta',
    ]))
    expect(AGENT_SKILL_POLICY.futureAgentCandidates).toEqual([])
  })

  it('gives revenue and operations agents sequence creation and analytics skills', () => {
    const sequenceAgents = ['pip', 'theo', 'maya', 'nora', 'support', 'data', 'sales']
    for (const agentId of sequenceAgents) {
      expect(AGENT_SKILL_POLICY.skillCatalog['email-outreach'].allowedAgentIds).toContain(agentId)
      expect(AGENT_SKILL_POLICY.agents[agentId].runtimeSkills).toContain('email-outreach')
    }

    const performanceAgents = ['pip', 'theo', 'maya', 'nora', 'support', 'data', 'docs', 'seo', 'sales']
    for (const agentId of performanceAgents) {
      expect(AGENT_SKILL_POLICY.skillCatalog.analytics.allowedAgentIds).toContain(agentId)
      expect(AGENT_SKILL_POLICY.skillCatalog['data-analyst'].allowedAgentIds).toContain(agentId)
      expect(AGENT_SKILL_POLICY.agents[agentId].runtimeSkills).toEqual(expect.arrayContaining([
        'analytics',
        'data-analyst',
      ]))
    }
  })

  it('builds Firestore policy state and rewrites Hermes external_dirs', () => {
    const state = buildAgentSkillPolicyState('pip')
    expect(state).toEqual(expect.objectContaining({
      mode: 'hard_allowlist',
      policyVersion: AGENT_SKILL_POLICY.version,
      appliedAt: null,
      appliedVersion: null,
      vpsExternalDir: '/var/lib/hermes/agent-skills/pip',
      catalogVersion: AGENT_SKILL_POLICY.catalogVersion,
      runtimeSkills: AGENT_SKILL_POLICY.agents.pip.runtimeSkills,
      capabilities: AGENT_SKILL_POLICY.agents.pip.capabilities,
      reviewerAgentId: AGENT_SKILL_POLICY.agents.pip.reviewerAgentId,
    }))

    expect(withAgentPolicyExternalDir({
      model: 'gpt-5',
      skills: { external_dirs: ['/var/lib/hermes/pib-skills'], local: true },
    }, 'pip')).toEqual({
      model: 'gpt-5',
      skills: {
        external_dirs: ['/var/lib/hermes/agent-skills/pip'],
        local: true,
      },
    })
  })

  it('reports drift until installed skills and config match the manifest exactly', () => {
    expect(computeAgentSkillDrift({
      agentId: 'sage',
      installedPibSkills: AGENT_SKILL_POLICY.agents.sage.runtimeSkills,
      installedGlobalSkills: AGENT_SKILL_POLICY.agents.sage.globalSkills,
      configExternalDirs: ['/var/lib/hermes/agent-skills/sage'],
    })?.status).toBe('in_sync')

    const drift = computeAgentSkillDrift({
      agentId: 'sage',
      installedPibSkills: ['analytics', 'content-engine'],
      installedGlobalSkills: [],
      configExternalDirs: ['/var/lib/hermes/pib-skills'],
    })

    expect(drift).toEqual(expect.objectContaining({
      status: 'drifted',
      expectedExternalDirs: ['/var/lib/hermes/agent-skills/sage'],
      configExternalDirs: ['/var/lib/hermes/pib-skills'],
    }))
    expect(drift?.missingPibSkills).toContain('research-intelligence')
    expect(drift?.unexpectedPibSkills).toContain('content-engine')
  })
})
