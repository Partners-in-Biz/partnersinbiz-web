import {
  AGENT_REGISTRY,
  getAgentRegistryEntry,
  mergeAgentRegistry,
  normalizeAgentRegistryInput,
} from '@/lib/agents/registry'
import { AGENT_IDS } from '@/lib/agents/types'

describe('agent registry', () => {
  it('advertises platform agents with responsibilities, skills, cron loops, scopes, and examples', () => {
    expect(Object.keys(AGENT_REGISTRY).sort()).toEqual(['maya', 'nora', 'pip', 'sage', 'sales', 'theo'])

    for (const agentId of AGENT_IDS) {
      const entry = mergeAgentRegistry(agentId)
      expect(entry).toBeDefined()
      expect(entry.responsibilities.length).toBeGreaterThan(0)
      expect(entry.skills.length).toBeGreaterThan(0)
      expect(entry.cronWatchLoops.length).toBeGreaterThan(0)
      expect(entry.allowedScopes.length).toBeGreaterThan(0)
      expect(entry.exampleTaskTypes.length).toBeGreaterThan(0)
    }

    expect(getAgentRegistryEntry('pip')).toBeDefined()
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

  it('uses the hard skill policy as the default advertised skill list', () => {
    const merged = mergeAgentRegistry('seo', {})

    expect(merged.skills).toEqual(expect.arrayContaining([
      'partnersinbiz/research-intelligence',
      'partnersinbiz/seo-sprint-manager',
      'research/blogwatcher',
    ]))
  })
})
