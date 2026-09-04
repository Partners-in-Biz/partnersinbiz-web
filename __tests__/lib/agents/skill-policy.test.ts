import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_SKILL_POLICY,
  buildAgentSkillPolicyState,
  classifyInstalledSkills,
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
      'agent-runtime-gather',
      'agent-skill-drift-gather',
      'approval-queue-gather',
      'ceo-on-demand-gather',
      'chat-surface-gather',
      'impeccable-design-discipline',
      'system-auth',
      'billing-finance',
      'client-documents',
      'client-manager',
      'collaboration-runtime',
      'content-engine',
      'crm-sales',
      'crm-hygiene-gather',
      'sales-operating-system',
      'data-analyst',
      'daily-workflow',
      'docs-lead',
      'email-marketing-governance',
      'email-outreach',
      'evidence-ledger',
      'geo-seo-service',
      'google-workspace',
      'platform-ops',
      'agent-runtime-ops',
      'pib-agent-org-setup',
      'pib-bot-teams',
      'pib-chat-canvas',
      'pib-staff-billing-access',
      'platform-admin-users',
      'reports',
      'project-management',
      'workflow-graph-operator',
      'interactive-project-planning',
      'properties',
      'qa-release',
      'research-intelligence',
      'seo-sprint-manager',
      'social-media-manager',
      'social-recovery-gather',
      'studio-artifact-orchestrate',
      'studio-artifact-review',
      'studio-context-gather',
      'studio-release-handoff',
      'support-manager',
      'video-editor-ops',
      'creative-canvas-ops',
      'book-studio-ops',
      'browser-agent',
      'cursor-agent',
      'youtube-studio-ops',
      'conversations-runtime',
      'life-os-ops',
      'llm-providers-ops',
    ])

    for (const skill of AGENT_SKILL_POLICY.repoPibSkills) {
      expect(existsSync(join(process.cwd(), '.claude/skills', skill, 'SKILL.md'))).toBe(true)
    }
  })

  it('assigns the governed Studio workflow to the operators and specialists that use it', () => {
    expect(AGENT_SKILL_POLICY.agents.pip.runtimeSkills).not.toEqual(expect.arrayContaining([
      'studio-context-gather',
      'studio-artifact-orchestrate',
    ]))
    expect(AGENT_SKILL_POLICY.agents['qa-release'].runtimeSkills).toEqual(expect.arrayContaining([
      'studio-context-gather',
      'studio-artifact-review',
      'studio-release-handoff',
    ]))
    expect(AGENT_SKILL_POLICY.agents.maya.runtimeSkills).toEqual(expect.arrayContaining([
      'studio-context-gather',
      'studio-artifact-orchestrate',
      'studio-artifact-review',
    ]))
    expect(AGENT_SKILL_POLICY.agents.docs.runtimeSkills).toEqual(expect.arrayContaining([
      'studio-context-gather',
      'studio-artifact-orchestrate',
      'studio-artifact-review',
      'studio-release-handoff',
    ]))
    expect(AGENT_SKILL_POLICY.agents.theo.runtimeSkills).not.toContain('studio-release-handoff')

    expect(AGENT_SKILL_POLICY.skillCatalog['studio-context-gather']).toEqual(expect.objectContaining({
      ownerAgentId: 'pip',
      riskLevel: 'low',
    }))
    expect(AGENT_SKILL_POLICY.skillCatalog['studio-release-handoff']).toEqual(expect.objectContaining({
      ownerAgentId: 'qa-release',
      riskLevel: 'critical',
    }))
  })

  it('documents complete gather evidence and replay-safe orchestration envelopes', () => {
    const gatherScript = readFileSync(join(
      process.cwd(),
      '.claude/skills/studio-context-gather/scripts/gather-studio-context.mjs',
    ), 'utf8')
    expect(gatherScript).toContain('canonicalLink')
    expect(gatherScript).toContain('checkedEndpoint')
    expect(gatherScript).toContain('checkedFields')
    expect(gatherScript).toContain('correlationKey')
    expect(gatherScript).toContain('missing_lineage')

    const orchestrateSkill = readFileSync(join(
      process.cwd(),
      '.claude/skills/studio-artifact-orchestrate/SKILL.md',
    ), 'utf8')
    expect(orchestrateSkill).toContain('studio_artifact_proposal')
    expect(orchestrateSkill).toContain('studio_artifact_result')
    expect(orchestrateSkill).toContain('studio_artifact_existing_result')
  })

  it('keeps the project-management create contract aligned with the API lifecycle statuses', () => {
    const projectSkill = readFileSync(join(
      process.cwd(),
      '.claude/skills/project-management/SKILL.md',
    ), 'utf8')

    expect(projectSkill).toContain('`discovery`, `design`, `development`, `review`, `live`, and `maintenance`')
    expect(projectSkill).toContain('400 Invalid status')
    expect(projectSkill).not.toContain('"status": "active"')
  })

  it('requires model-level proof and profile-specific OAuth recovery for Hermes incidents', () => {
    const runtimeSkill = readFileSync(join(
      process.cwd(),
      '.claude/skills/agent-runtime-ops/SKILL.md',
    ), 'utf8')

    expect(runtimeSkill).toContain('Reply with exactly CODEXOK and nothing else.')
    expect(runtimeSkill).toContain('NRestarts')
    expect(runtimeSkill).toContain('auth add openai-codex --type oauth --no-browser --timeout 600')
    expect(runtimeSkill).toContain("do not copy another working profile's `auth.json` or refresh token")
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
      'finance',
      'maya',
      'nora',
      'people',
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
    expect(AGENT_SKILL_POLICY.agents.finance.name).toBe('Finch')
    expect(AGENT_SKILL_POLICY.agents.people.name).toBe('Nova')
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
      'marketing/ads-strategy',
      'marketing/ads-platforms',
      'marketing/ads-creative',
    ]))
    expect(AGENT_SKILL_POLICY.futureAgentCandidates).toEqual([])
  })

  it('keeps the governed planning workflow on Theo runtime and still catalog-allows Pip', () => {
    const planningSkills = [
      'agent-skills/using-agent-skills',
      'agent-skills/interview-me',
      'agent-skills/planning-and-task-breakdown',
      'agent-skills/spec-driven-development',
      'software-development/writing-plans',
    ]
    expect(AGENT_SKILL_POLICY.agents.theo.runtimeSkills).toEqual(expect.arrayContaining(planningSkills))
    expect(AGENT_SKILL_POLICY.agents.pip.runtimeSkills).not.toEqual(expect.arrayContaining(planningSkills))
    for (const skill of planningSkills) {
      expect(AGENT_SKILL_POLICY.skillCatalog[skill].allowedAgentIds).toContain('pip')
      expect(AGENT_SKILL_POLICY.skillCatalog[skill].allowedAgentIds).toContain('theo')
    }
  })

  it('gives role owners outreach skills and keeps analytics on the data seats', () => {
    // Lean core: outreach stays on marketing/ops/sales owners, not QA or support.
    const sequenceAgents = ['maya', 'nora', 'sales']
    for (const agentId of sequenceAgents) {
      expect(AGENT_SKILL_POLICY.skillCatalog['email-outreach'].allowedAgentIds).toContain(agentId)
      expect(AGENT_SKILL_POLICY.agents[agentId].runtimeSkills).toContain('email-outreach')
    }

    expect(AGENT_SKILL_POLICY.agents['qa-release'].runtimeSkills).not.toContain('email-outreach')
    expect(AGENT_SKILL_POLICY.agents.support.runtimeSkills).not.toContain('email-outreach')
    expect(AGENT_SKILL_POLICY.agents.data.runtimeSkills).not.toContain('email-outreach')
    expect(AGENT_SKILL_POLICY.agents.theo.runtimeSkills).not.toContain('email-outreach')
    expect(AGENT_SKILL_POLICY.skillCatalog['email-outreach'].allowedAgentIds).not.toContain('theo')

    const performanceAgents = ['data', 'ads', 'finance']
    for (const agentId of performanceAgents) {
      expect(AGENT_SKILL_POLICY.skillCatalog.analytics.allowedAgentIds).toContain(agentId)
      expect(AGENT_SKILL_POLICY.skillCatalog['data-analyst'].allowedAgentIds).toContain(agentId)
      expect(AGENT_SKILL_POLICY.agents[agentId].runtimeSkills).toEqual(expect.arrayContaining([
        'analytics',
        'data-analyst',
      ]))
    }
    expect(AGENT_SKILL_POLICY.agents.pip.runtimeSkills).not.toEqual(expect.arrayContaining([
      'analytics',
      'data-analyst',
    ]))
  })

  it('delivers safe daily-workflow v1.2 to every managed agent and the client pack', () => {
    const agentIds = Object.keys(AGENT_SKILL_POLICY.agents).sort()
    const catalog = AGENT_SKILL_POLICY.skillCatalog['daily-workflow']
    const repoSkill = readFileSync(join(
      process.cwd(),
      '.claude/skills/daily-workflow/SKILL.md',
    ), 'utf8')
    const packSkill = readFileSync(join(
      process.cwd(),
      'packs/pib-system-skills/skills/daily-workflow/SKILL.md',
    ), 'utf8')
    const packManifest = JSON.parse(readFileSync(join(
      process.cwd(),
      'packs/pib-system-skills/manifest.json',
    ), 'utf8'))

    expect(catalog.allowedAgentIds.slice().sort()).toEqual(agentIds)
    for (const agentId of agentIds) {
      expect(AGENT_SKILL_POLICY.agents[agentId].pibSkills).toContain('daily-workflow')
      expect(AGENT_SKILL_POLICY.agents[agentId].runtimeSkills).toContain('daily-workflow')
    }

    expect(repoSkill).toContain('version: 1.2.0')
    expect(packSkill).toBe(repoSkill)
    expect(packManifest.tiers.core.skills).toContain('daily-workflow')
    expect(packManifest.skills['daily-workflow']).toEqual(expect.objectContaining({
      tier: 'core',
      owner: 'pip',
      risk: 'high',
    }))

    expect(repoSkill).not.toContain('rm -rf')
    expect(repoSkill).not.toContain('git add -A')
    expect(repoSkill).not.toContain('/Users/peetstander/Cowork')
    expect(repoSkill).toContain('Only stop development servers started during the current session')
  })

  it('delivers pib-bot-teams to every managed agent and the core pack', () => {
    const agentIds = Object.keys(AGENT_SKILL_POLICY.agents).sort()
    const catalog = AGENT_SKILL_POLICY.skillCatalog['pib-bot-teams']
    const repoSkill = readFileSync(join(
      process.cwd(),
      '.claude/skills/pib-bot-teams/SKILL.md',
    ), 'utf8')
    const packSkill = readFileSync(join(
      process.cwd(),
      'packs/pib-system-skills/skills/pib-bot-teams/SKILL.md',
    ), 'utf8')
    const packManifest = JSON.parse(readFileSync(join(
      process.cwd(),
      'packs/pib-system-skills/manifest.json',
    ), 'utf8'))

    expect(catalog.allowedAgentIds.slice().sort()).toEqual(agentIds)
    expect(catalog.allowedAgentIds).toEqual(AGENT_SKILL_POLICY.skillCatalog['daily-workflow'].allowedAgentIds)
    expect(catalog).toEqual(expect.objectContaining({
      ownerAgentId: 'pip',
      riskLevel: 'medium',
      syncTarget: 'vps',
    }))
    for (const agentId of agentIds) {
      expect(AGENT_SKILL_POLICY.agents[agentId].pibSkills).toContain('pib-bot-teams')
      expect(AGENT_SKILL_POLICY.agents[agentId].runtimeSkills).toContain('pib-bot-teams')
    }

    expect(packSkill).toBe(repoSkill)
    expect(packManifest.tiers.core.skills).toContain('pib-bot-teams')
    expect(packManifest.skills['pib-bot-teams']).toEqual(expect.objectContaining({
      tier: 'core',
      owner: 'pip',
      risk: 'medium',
    }))
    expect(repoSkill).toContain('Address teammates with `@handle`')
    expect(repoSkill).toContain('message_agent')
    expect(repoSkill).toContain('maxRounds')
    expect(repoSkill).toContain('Desktop-only')
    expect(repoSkill).toContain('needsYou')
    expect(repoSkill).toContain('hermes-bots-groups')
    expect(repoSkill).toContain('profiles.configure')
    expect(catalog.allowedAgentIds).not.toContain('*')
  })

  it('delivers pib-chat-canvas to every managed agent, the core pack, and marketplace public packs', () => {
    const agentIds = Object.keys(AGENT_SKILL_POLICY.agents).sort()
    const catalog = AGENT_SKILL_POLICY.skillCatalog['pib-chat-canvas']
    const repoSkill = readFileSync(join(
      process.cwd(),
      '.claude/skills/pib-chat-canvas/SKILL.md',
    ), 'utf8')
    const packSkill = readFileSync(join(
      process.cwd(),
      'packs/pib-system-skills/skills/pib-chat-canvas/SKILL.md',
    ), 'utf8')
    const packManifest = JSON.parse(readFileSync(join(
      process.cwd(),
      'packs/pib-system-skills/manifest.json',
    ), 'utf8'))

    expect(catalog.allowedAgentIds.slice().sort()).toEqual(agentIds)
    expect(catalog).toEqual(expect.objectContaining({
      ownerAgentId: 'pip',
      riskLevel: 'low',
      syncTarget: 'vps',
    }))
    for (const agentId of agentIds) {
      expect(AGENT_SKILL_POLICY.agents[agentId].pibSkills).toContain('pib-chat-canvas')
      expect(AGENT_SKILL_POLICY.agents[agentId].runtimeSkills).toContain('pib-chat-canvas')
    }

    expect(packSkill).toBe(repoSkill)
    expect(packManifest.tiers.core.skills).toContain('pib-chat-canvas')
    expect(packManifest.skills['pib-chat-canvas']).toEqual(expect.objectContaining({
      tier: 'core',
      owner: 'pip',
      risk: 'low',
    }))
    expect(repoSkill).toContain('```pib:chart')
    expect(repoSkill).toContain('```pib:mermaid')
    expect(repoSkill).toContain('```pib:math')
    expect(repoSkill).toContain('```pib:html')
    expect(repoSkill).toContain('Never put secrets or raw HTML from a web page into `pib:html`')
    expect(repoSkill).toContain('Write files under the working directory and reference them by absolute path')
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

  it('classifies fully qualified globals without colliding with PiB skills that share a basename', () => {
    const installed = classifyInstalledSkills([
      'partnersinbiz/system-auth',
      'partnersinbiz/collaboration-runtime',
      'partnersinbiz/evidence-ledger',
      'partnersinbiz/project-management',
      'partnersinbiz/daily-workflow',
      'partnersinbiz/pib-bot-teams',
      'partnersinbiz/pib-chat-canvas',
      'partnersinbiz/client-documents',
      'partnersinbiz/docs-lead',
      'partnersinbiz/studio-artifact-orchestrate',
      'partnersinbiz/studio-artifact-review',
      'partnersinbiz/studio-context-gather',
      'partnersinbiz/studio-release-handoff',
      'partnersinbiz/interactive-project-planning',
      'partnersinbiz/impeccable-design-discipline',
      'partnersinbiz/browser-agent',
      'partnersinbiz/cursor-agent',
      'partnersinbiz/google-workspace',
      'productivity/google-workspace',
      'productivity/powerpoint',
    ])

    expect(installed.pib.slice().sort()).toEqual(AGENT_SKILL_POLICY.agents.docs.runtimeSkills.slice().sort())
    expect(installed.global.slice().sort()).toEqual(AGENT_SKILL_POLICY.agents.docs.globalSkills.slice().sort())
    expect(computeAgentSkillDrift({
      agentId: 'docs',
      installedPibSkills: installed.pib,
      installedGlobalSkills: installed.global,
      configExternalDirs: ['/var/lib/hermes/agent-skills/docs'],
    })?.status).toBe('in_sync')
  })
})
