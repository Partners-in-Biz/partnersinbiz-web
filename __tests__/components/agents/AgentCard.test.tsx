import { render, screen } from '@testing-library/react'
import { AgentCard, type AgentTeamDoc } from '@/components/agents/AgentCard'

const baseAgent: AgentTeamDoc = {
  agentId: 'pip',
  name: 'Pip',
  role: 'Orchestrator',
  persona: 'Routes Partners in Biz work.',
  defaultModel: 'gpt-5.5 / glm-4.7',
  iconKey: 'smart_toy',
  colorKey: 'sky',
  enabled: true,
  baseUrl: 'https://pip.test',
  apiKey: 'masked',
  responsibilities: [],
  skills: [],
  cronWatchLoops: [],
  allowedScopes: [],
  exampleTaskTypes: [],
}

describe('AgentCard', () => {
  it('shows live runtime model details instead of stale registry labels', () => {
    render(
      <AgentCard
        agent={{
          ...baseAgent,
          runtimeModel: {
            source: 'live_config',
            label: 'openai-codex / gpt-5.5 → anthropic / claude-sonnet-4-6',
            primaryProvider: 'openai-codex',
            primaryModel: 'gpt-5.5',
            fallbackProvider: 'anthropic',
            fallbackModel: 'claude-sonnet-4-6',
            registryDefaultModel: 'gpt-5.5 / glm-4.7',
            staleRegistry: true,
          },
        }}
        onClick={jest.fn()}
        healthStatus="ok"
      />,
    )

    expect(screen.getByText('openai-codex / gpt-5.5 → anthropic / claude-sonnet-4-6')).toBeInTheDocument()
    expect(screen.getByText('Live config')).toBeInTheDocument()
    expect(screen.getByText('Registry stale')).toBeInTheDocument()
    expect(screen.queryByText('gpt-5.5 / glm-4.7')).not.toBeInTheDocument()
  })
})
