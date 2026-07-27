import { buildConnectionWhere } from '@/lib/chat/connection-where'

describe('buildConnectionWhere', () => {
  it('returns null when nothing useful is known', () => {
    expect(buildConnectionWhere({})).toBeNull()
    expect(buildConnectionWhere(null)).toBeNull()
  })

  it('formats VPS presence with mapping', () => {
    const where = buildConnectionWhere({
      deviceKind: 'vps',
      machineLabel: 'Partners VPS',
      mappingLabel: 'Partners in Biz',
      online: true,
    })
    expect(where).toEqual(expect.objectContaining({
      kind: 'VPS',
      label: 'Partners VPS',
      mappingLabel: 'Partners in Biz',
      display: 'VPS · Partners VPS · Partners in Biz',
      online: true,
      icon: 'dns',
    }))
  })

  it('formats linked Mac computers', () => {
    const where = buildConnectionWhere({
      runtimeKind: 'linked-computer',
      machineLabel: "Peet's Mac",
      online: true,
    })
    expect(where).toEqual(expect.objectContaining({
      kind: 'Computer',
      display: "Computer · Peet's Mac",
      icon: 'computer',
    }))
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

  it('uses dispatch metadata from the last agent turn', () => {
    const where = buildConnectionWhere({
      runtimeKind: 'vps',
      machineLabel: 'hermes-vps-01',
      online: null,
    })
    expect(where?.display).toBe('VPS · hermes-vps-01')
    expect(where?.online).toBeNull()
  })
})
