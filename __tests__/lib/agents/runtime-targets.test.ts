import { publicRuntimeTargetPresence, runtimeTargetPhysicalTransportIdentity, selectAgentRuntimeTarget } from '@/lib/agents/runtime-targets'

describe('agent runtime targets', () => {
  const now = Date.parse('2026-07-08T10:00:00Z')

  it('binds agent profile URLs to one physical VPS or Mac transport family', () => {
    expect(runtimeTargetPhysicalTransportIdentity({ baseUrl: 'https://hermes.example/profiles/pip' }))
      .toBe(runtimeTargetPhysicalTransportIdentity({ baseUrl: 'https://hermes.example/profiles/theo/' }))
    expect(runtimeTargetPhysicalTransportIdentity({ baseUrl: 'https://hermes.example/local-profiles/pip', hostId: 'peets-mac' }))
      .toBe(runtimeTargetPhysicalTransportIdentity({ baseUrl: 'https://hermes.example/local-profiles/maya', hostId: 'peets-mac' }))
    expect(runtimeTargetPhysicalTransportIdentity({ baseUrl: 'https://hermes.example/profiles/pip' }))
      .not.toBe(runtimeTargetPhysicalTransportIdentity({ baseUrl: 'https://hermes.example/local-profiles/pip' }))
  })

  it('falls back to the legacy single endpoint when no runtime target map exists', () => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      legacy: { baseUrl: 'https://hermes-api.example/profiles/pip/', apiKey: 'vps-key', enabled: true },
    })).toEqual({
      targetId: 'legacy',
      baseUrl: 'https://hermes-api.example/profiles/pip',
      apiKey: 'vps-key',
      source: 'legacy',
      runtimeKind: 'legacy',
      machineLabel: 'Legacy Hermes',
      transportIdentity: 'lSSJ8KbK9otHUHGEsuxwZ7AsaVF3hkPzDiwHsweoQDc',
    })
  })

  it('uses the same physical transport identity for agent-specific VPS profile URLs', () => {
    const pip = selectAgentRuntimeTarget({
      nowMs: now,
      defaultTargetId: 'vps',
      runtimeTargets: {
        vps: { baseUrl: 'https://hermes-api.example/profiles/pip', apiKey: 'vps-key', enabled: true, priority: 10 },
      },
    })
    const theo = selectAgentRuntimeTarget({
      nowMs: now,
      defaultTargetId: 'vps',
      runtimeTargets: {
        vps: { baseUrl: 'https://hermes-api.example/profiles/theo', apiKey: 'vps-key', enabled: true, priority: 10 },
      },
    })
    expect(pip).toMatchObject({ targetId: 'vps', transportIdentity: expect.any(String) })
    expect(theo).toMatchObject({ targetId: 'vps', transportIdentity: (pip as { transportIdentity: string }).transportIdentity })
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
          lastSeenAt: '2026-07-08T09:59:00Z',
        },
      },
    })).toMatchObject({ targetId: 'local' })
  })

  it.each([
    ['missing', {}, 'runtime_target_not_found'],
    ['disabled', { local: { baseUrl: 'https://local.example', apiKey: 'key', enabled: false, capabilities: ['local-files'], lastSeenAt: '2026-07-08T09:59:00Z' } }, 'runtime_target_disabled'],
    ['stale', { local: { baseUrl: 'https://local.example', apiKey: 'key', enabled: true, capabilities: ['local-files'], lastSeenAt: '2026-07-08T09:00:00Z' } }, 'runtime_target_stale'],
    ['unhealthy', { local: { baseUrl: 'https://local.example', apiKey: 'key', enabled: true, capabilities: ['local-files'], lastSeenAt: '2026-07-08T09:59:00Z', lastHealthStatus: 'unreachable' } }, 'runtime_target_unhealthy'],
    ['degraded', { local: { baseUrl: 'https://local.example', apiKey: 'key', enabled: true, capabilities: ['local-files'], lastSeenAt: '2026-07-08T09:59:00Z', lastHealthStatus: 'degraded' } }, 'runtime_target_unhealthy'],
    ['keyless', { local: { baseUrl: 'https://local.example', enabled: true, capabilities: ['local-files'], lastSeenAt: '2026-07-08T09:59:00Z' } }, 'runtime_target_missing_api_key'],
  ])('returns a typed error for an explicit %s target without falling back', (_case, localTarget, code) => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      preference: 'local',
      runtimeTargets: {
        vps: { baseUrl: 'https://vps.example', apiKey: 'vps-key', enabled: true },
        ...localTarget,
      },
      legacy: { baseUrl: 'https://legacy.example', apiKey: 'legacy-key', enabled: true },
    })).toEqual({ ok: false, code, requestedTargetId: 'local' })
  })

  it('keeps fallback behavior for auto selection', () => {
    expect(selectAgentRuntimeTarget({
      nowMs: now,
      preference: 'auto',
      runtimeTargets: {
        vps: { baseUrl: 'https://vps.example', apiKey: 'vps-key', enabled: true },
        local: { baseUrl: 'https://local.example', apiKey: 'key', enabled: true, capabilities: ['local-files'], lastSeenAt: '2026-07-08T09:00:00Z' },
      },
    })).toMatchObject({ targetId: 'vps' })
  })

  it('rejects unsafe explicit IDs instead of reflecting them or selecting another runtime', () => {
    expect(selectAgentRuntimeTarget({
      preference: 'https://evil.example/path\napiKey=secret',
      runtimeTargets: { vps: { baseUrl: 'https://vps.example', apiKey: 'vps-key', enabled: true } },
    })).toEqual({ ok: false, code: 'runtime_target_invalid_id', requestedTargetId: 'invalid' })
  })

  it('drops unsafe configured IDs and sanitizes labels used as machine metadata', () => {
    const targets = {
      'https://evil.example/path': {
        id: 'apiKey=super-secret', baseUrl: 'https://evil.example', apiKey: 'secret', enabled: true,
      },
      local: {
        baseUrl: 'https://local.example', apiKey: 'key', enabled: true, capabilities: ['local-files'],
        lastSeenAt: '2026-07-08T09:59:00Z', label: 'Local\napiKey=secret/../../etc/passwd', hostId: 'bad\nhost/path',
      },
    }

    expect(publicRuntimeTargetPresence(targets, { nowMs: now })).toEqual([
      expect.objectContaining({ id: 'local', label: 'Local' }),
    ])
    expect(selectAgentRuntimeTarget({ preference: 'local', runtimeTargets: targets, nowMs: now })).toMatchObject({
      targetId: 'local', machineLabel: 'Local',
    })
    expect(JSON.stringify(publicRuntimeTargetPresence(targets, { nowMs: now }))).not.toMatch(/apiKey|secret|\.\.\/|evil\.example/)
  })

  it('returns sanitized, presence-aware runtime targets for the Workspace UI', () => {
    expect(publicRuntimeTargetPresence({
      vps: {
        baseUrl: 'https://hermes-api.example/profiles/pip',
        apiKey: 'secret-vps-key',
        enabled: true,
        label: 'VPS Hermes',
      },
      local: {
        baseUrl: 'https://mac-tunnel.example/profiles/pip',
        apiKey: 'secret-local-key',
        enabled: true,
        hostId: 'peets-mac-mini',
        capabilities: ['local-files'],
        lastSeenAt: '2026-07-08T09:59:00Z',
        lastHealthStatus: 'ok',
      },
    }, { nowMs: now })).toEqual([
      {
        id: 'vps',
        label: 'VPS Hermes',
        enabled: true,
        isLocal: false,
        isFresh: true,
        isHealthy: true,
        selectable: true,
        lastSeenAt: null,
        ageSeconds: null,
        lastHealthStatus: null,
      },
      {
        id: 'local',
        label: "Local: Peet's Mac",
        hostId: 'peets-mac-mini',
        enabled: true,
        isLocal: true,
        isFresh: true,
        isHealthy: true,
        selectable: true,
        lastSeenAt: '2026-07-08T09:59:00.000Z',
        ageSeconds: 60,
        lastHealthStatus: 'ok',
      },
    ])
  })

  it('marks stale local runtimes unavailable without exposing connection details', () => {
    const [local] = publicRuntimeTargetPresence({
      local: {
        baseUrl: 'https://mac-tunnel.example/profiles/pip',
        apiKey: 'secret-local-key',
        enabled: true,
        hostId: 'peets-mac-mini',
        capabilities: ['local-files'],
        lastSeenAt: '2026-07-08T09:00:00Z',
      },
    }, { nowMs: now })
    expect(local).toMatchObject({ id: 'local', isFresh: false, selectable: false, ageSeconds: 3600 })
    expect(local).not.toHaveProperty('baseUrl')
    expect(local).not.toHaveProperty('apiKey')
  })

  it('marks a fresh but unreachable runtime unavailable', () => {
    const [local] = publicRuntimeTargetPresence({
      local: {
        baseUrl: 'https://mac-tunnel.example/profiles/pip',
        apiKey: 'secret-local-key',
        enabled: true,
        capabilities: ['local-files'],
        lastSeenAt: '2026-07-08T09:59:00Z',
        lastHealthStatus: 'unreachable',
      },
    }, { nowMs: now })
    expect(local).toMatchObject({ isFresh: true, isHealthy: false, selectable: false })
  })
})
