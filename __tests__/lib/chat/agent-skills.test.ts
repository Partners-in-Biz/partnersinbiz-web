import { collectAgentSkillNames, normalizeAgentSkillName } from '@/lib/chat/agent-skills'

describe('collectAgentSkillNames', () => {
  it('collapses partnersinbiz/ prefixes onto the unprefixed runtime name', () => {
    expect(normalizeAgentSkillName('partnersinbiz/system-auth')).toBe('system-auth')
    expect(normalizeAgentSkillName('autonomous-ai-agents/hermes-agent')).toBe('autonomous-ai-agents/hermes-agent')

    const names = collectAgentSkillNames({
      skills: ['partnersinbiz/system-auth', 'autonomous-ai-agents/hermes-agent'],
      skillPolicy: {
        runtimeSkills: ['system-auth', 'platform-ops'],
        pibSkills: ['system-auth', 'platform-ops'],
        globalSkills: ['autonomous-ai-agents/hermes-agent'],
      },
    })

    expect(names).toEqual(['system-auth', 'platform-ops', 'autonomous-ai-agents/hermes-agent'])
  })
})
