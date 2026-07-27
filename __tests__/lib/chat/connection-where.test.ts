import { buildConnectionWhere } from '@/lib/chat/connection-where'

describe('buildConnectionWhere', () => {
  it('returns null when nothing useful is known', () => {
    expect(buildConnectionWhere({})).toBeNull()
    expect(buildConnectionWhere(null)).toBeNull()
  })

  it('formats an org VPS from structured deviceKind (any org label)', () => {
    const where = buildConnectionWhere({
      deviceKind: 'vps',
      machineLabel: 'acme-edge-01',
      mappingLabel: 'Client Growth',
      online: true,
    })
    expect(where).toEqual(expect.objectContaining({
      kind: 'VPS',
      label: 'acme-edge-01',
      mappingLabel: 'Client Growth',
      display: 'VPS · acme-edge-01 · Client Growth',
      online: true,
      icon: 'dns',
    }))
  })

  it('formats a computer-only org (no VPS required)', () => {
    const where = buildConnectionWhere({
      deviceKind: 'computer',
      runtimeKind: 'linked-computer',
      machineLabel: 'Studio Mini',
      online: true,
    })
    expect(where).toEqual(expect.objectContaining({
      kind: 'Computer',
      display: 'Computer · Studio Mini',
      icon: 'computer',
    }))
  })

  it('does not reclassify from free-text names (orgs name machines anything)', () => {
    // A linked computer literally named "...VPS..." must stay Computer when deviceKind says so.
    const where = buildConnectionWhere({
      deviceKind: 'computer',
      runtimeKind: 'linked-computer',
      machineLabel: 'Backup VPS Laptop',
      online: true,
    })
    expect(where?.kind).toBe('Computer')
    expect(where?.display).toBe('Computer · Backup VPS Laptop')
  })

  it('formats local runtime targets', () => {
    const where = buildConnectionWhere({
      runtimeTarget: 'local',
      runtimeLabel: 'Local',
      isLocal: true,
    })
    expect(where).toEqual(expect.objectContaining({
      kind: 'Local',
      display: 'Local',
      icon: 'hard_drive',
    }))
  })

  it('uses last-turn dispatch metadata for whatever host accepted the run', () => {
    const where = buildConnectionWhere({
      runtimeKind: 'vps',
      machineLabel: 'client-hermes-node',
      online: null,
    })
    expect(where?.display).toBe('VPS · client-hermes-node')
    expect(where?.online).toBeNull()
  })

  it('supports VPS-only inventory without any computer', () => {
    const where = buildConnectionWhere({
      deviceKind: 'vps',
      machineLabel: 'org-canonical-vps',
      online: true,
    })
    expect(where?.kind).toBe('VPS')
    expect(where?.label).toBe('org-canonical-vps')
  })
})
