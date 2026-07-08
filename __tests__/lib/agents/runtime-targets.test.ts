import { selectAgentRuntimeTarget } from '@/lib/agents/runtime-targets'

describe('agent runtime targets', () => {
  const now = Date.parse('2026-07-08T10:00:00Z')

  it('falls back to the legacy single endpoint when no runtime target map exists', () => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      legacy: { baseUrl: 'https://hermes-api.example/profiles/pip/', apiKey: 'vps-key', enabled: true },
    })).toEqual({
      targetId: 'legacy',
      baseUrl: 'https://hermes-api.example/profiles/pip',
      apiKey: 'vps-key',
      source: 'legacy',
    })
  })

  it('selects the default VPS runtime from a multi-target map', () => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      defaultTargetId: 'vps',
      runtimeTargets: {
        vps: { baseUrl: 'https://hermes-api.example/profiles/pip', apiKey: 'vps-key', enabled: true, priority: 10 },
        local: {
          baseUrl: 'https://mac-tunnel.example/profiles/pip',
          apiKey: 'local-key',
          enabled: true,
          priority: 1,
          capabilities: ['local-files'],
          lastSeenAt: '2026-07-08T09:59:00Z',
        },
      },
    })).toMatchObject({ targetId: 'vps', baseUrl: 'https://hermes-api.example/profiles/pip', apiKey: 'vps-key' })
  })

  it('can prefer a fresh local runtime for computer-use/local-files work', () => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      preferLocal: true,
      runtimeTargets: {
        vps: { baseUrl: 'https://hermes-api.example/profiles/pip', apiKey: 'vps-key', enabled: true, priority: 10 },
        local: {
          baseUrl: 'https://mac-tunnel.example/profiles/pip',
          apiKey: 'local-key',
          enabled: true,
          priority: 1,
          capabilities: ['local-files', 'computer-use'],
          lastSeenAt: '2026-07-08T09:59:00Z',
        },
      },
    })).toMatchObject({ targetId: 'local', baseUrl: 'https://mac-tunnel.example/profiles/pip', apiKey: 'local-key' })
  })

  it('does not auto-select a stale local runtime', () => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      preferLocal: true,
      runtimeTargets: {
        vps: { baseUrl: 'https://hermes-api.example/profiles/pip', apiKey: 'vps-key', enabled: true, priority: 10 },
        local: {
          baseUrl: 'https://mac-tunnel.example/profiles/pip',
          apiKey: 'local-key',
          enabled: true,
          priority: 1,
          capabilities: ['local-files'],
          lastSeenAt: '2026-07-08T09:00:00Z',
        },
      },
    })).toMatchObject({ targetId: 'vps' })
  })

  it('honours an explicit runtime target preference', () => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      preference: 'local',
      runtimeTargets: {
        vps: { baseUrl: 'https://hermes-api.example/profiles/pip', apiKey: 'vps-key', enabled: true, priority: 10 },
        local: {
          baseUrl: 'https://mac-tunnel.example/profiles/pip',
          apiKey: 'local-key',
          enabled: true,
          priority: 1,
          capabilities: ['local-files'],
        },
      },
    })).toMatchObject({ targetId: 'local' })
  })
})
