import {
  pickPreferredWorkspaceRuntime,
  runtimeMatchesPreferredTarget,
} from '@/lib/messages/preferred-workspace-runtime'

const mac = {
  id: 'device-mac',
  selectable: true,
  isLocal: true,
  deviceKind: 'computer' as const,
}

const vps = {
  id: 'partners-vps',
  selectable: true,
  isLocal: false,
  deviceKind: 'vps' as const,
  legacyRuntimeTargetIds: ['vps'],
}

describe('preferred-workspace-runtime', () => {
  it('honours the workspace defaultRuntimeTarget when that computer is selectable', () => {
    expect(pickPreferredWorkspaceRuntime([mac, vps], { preferredTargetId: 'device-mac' })).toEqual(mac)
    expect(pickPreferredWorkspaceRuntime([mac, vps], { preferredTargetId: 'partners-vps' })).toEqual(vps)
  })

  it('treats legacy defaultRuntimeTarget "vps" as any VPS machine', () => {
    expect(runtimeMatchesPreferredTarget(vps, 'vps')).toBe(true)
    expect(runtimeMatchesPreferredTarget(mac, 'vps')).toBe(false)
    expect(pickPreferredWorkspaceRuntime([mac, vps], { preferredTargetId: 'vps' })).toEqual(vps)
  })

  it('falls back to VPS before Mac when no preferred target matches', () => {
    expect(pickPreferredWorkspaceRuntime([mac, vps])).toEqual(vps)
    expect(pickPreferredWorkspaceRuntime([mac, { ...vps, selectable: false }])).toEqual(mac)
  })

  it('returns null when nothing is selectable', () => {
    expect(pickPreferredWorkspaceRuntime([
      { ...mac, selectable: false },
      { ...vps, selectable: false },
    ])).toBeNull()
  })
})
