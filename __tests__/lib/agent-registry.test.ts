import {
  AGENT_REGISTRY,
  getAgentRegistryEntry,
  mergeAgentRegistry,
  normalizeAgentRegistryInput,
} from '@/lib/agents/registry'

describe('agent registry', () => {
  it('advertises the five platform agents with responsibilities, skills, cron loops, scopes, and examples', () => {
    expect(Object.keys(AGENT_REGISTRY).sort()).toEqual(['maya', 'nora', 'pip', 'sage', 'theo'])

    for (const agentId of ['pip', 'theo', 'maya', 'sage', 'nora'] as const) {
      const entry = getAgentRegistryEntry(agentId)
      expect(entry).toBeDefined()
      expect(entry?.responsibilities.length).toBeGreaterThan(0)
      expect(entry?.skills.length).toBeGreaterThan(0)
      expect(entry?.cronWatchLoops.length).toBeGreaterThan(0)
      expect(entry?.allowedScopes.length).toBeGreaterThan(0)
      expect(entry?.exampleTaskTypes.length).toBeGreaterThan(0)
    }
  })

  it('normalizes future specialist registry input without accepting arbitrary shapes', () => {
    expect(normalizeAgentRegistryInput({
      responsibilities: ['first', 123, 'second'],
      skills: ['seo-sprint-manager'],
      cronWatchLoops: ['daily sitemap check'],
      allowedScopes: ['seo'],
      exampleTaskTypes: ['audit a sprint'],
      ignored: ['not persisted'],
    })).toEqual({
      responsibilities: ['first', 'second'],
      skills: ['seo-sprint-manager'],
      cronWatchLoops: ['daily sitemap check'],
      allowedScopes: ['seo'],
      exampleTaskTypes: ['audit a sprint'],
    })
  })

  it('merges canonical defaults with stored overrides so Firestore docs can evolve', () => {
    const merged = mergeAgentRegistry('pip', {
      responsibilities: ['custom routing'],
      skills: ['custom-skill'],
    })

    expect(merged.responsibilities).toEqual(['custom routing'])
    expect(merged.skills).toEqual(['custom-skill'])
    expect(merged.cronWatchLoops).toEqual(AGENT_REGISTRY.pip.cronWatchLoops)
    expect(merged.allowedScopes).toEqual(AGENT_REGISTRY.pip.allowedScopes)
    expect(merged.exampleTaskTypes).toEqual(AGENT_REGISTRY.pip.exampleTaskTypes)
  })
})
