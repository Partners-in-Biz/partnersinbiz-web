import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_SKILL_POLICY,
  buildAgentSkillPolicyState,
  computeAgentSkillDrift,
  withAgentPolicyExternalDir,
} from '@/lib/agents/skill-policy'

describe('agent skill policy manifest', () => {
  it('tracks every repo PiB skill that must sync to the VPS cache', () => {
    expect(AGENT_SKILL_POLICY.repoPibSkills).toEqual([
      'ads-manager',
      'analytics',
      'billing-finance',
      'client-documents',
      'client-manager',
      'content-engine',
      'crm-sales',
      'email-outreach',
      'google-workspace',
      'platform-ops',
      'project-management',
      'properties',
      'research-intelligence',
      'seo-sprint-manager',
      'social-media-manager',
    ])

    for (const skill of AGENT_SKILL_POLICY.repoPibSkills) {
      expect(existsSync(join(process.cwd(), '.claude/skills', skill, 'SKILL.md'))).toBe(true)
    }
  })

  it('keeps agent policies constrained to known PiB skills and profile-specific dirs', () => {
    const known = new Set(AGENT_SKILL_POLICY.repoPibSkills)

    for (const [agentId, policy] of Object.entries(AGENT_SKILL_POLICY.agents)) {
      expect(policy.vpsExternalDir).toBe(`/var/lib/hermes/agent-skills/${agentId}`)
      expect(policy.pibSkills.length).toBeGreaterThan(0)
      for (const skill of policy.pibSkills) expect(known.has(skill)).toBe(true)
    }
  })

  it('assigns Theo the engineering workflow while keeping SEO with Sage', () => {
    expect(AGENT_SKILL_POLICY.agents.theo.globalSkills).toEqual(expect.arrayContaining([
      'software-development/plan',
      'software-development/test-driven-development',
      'software-development/systematic-debugging',
      'software-development/writing-plans',
    ]))
    expect(AGENT_SKILL_POLICY.agents.sage.pibSkills).toEqual(expect.arrayContaining([
      'research-intelligence',
      'seo-sprint-manager',
    ]))
    expect(AGENT_SKILL_POLICY.futureAgentCandidates).toEqual(expect.arrayContaining([
      'seo',
      'ads',
      'docs',
      'support',
      'data',
      'qa-release',
    ]))
  })

  it('builds Firestore policy state and rewrites Hermes external_dirs', () => {
    const state = buildAgentSkillPolicyState('pip')
    expect(state).toEqual(expect.objectContaining({
      mode: 'hard_allowlist',
      policyVersion: AGENT_SKILL_POLICY.version,
      appliedAt: null,
      appliedVersion: null,
      vpsExternalDir: '/var/lib/hermes/agent-skills/pip',
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
      installedPibSkills: AGENT_SKILL_POLICY.agents.sage.pibSkills,
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
    expect(drift?.missingPibSkills).toContain('seo-sprint-manager')
    expect(drift?.unexpectedPibSkills).toContain('content-engine')
  })
})
