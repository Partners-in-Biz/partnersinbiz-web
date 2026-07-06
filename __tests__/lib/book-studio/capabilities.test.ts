// __tests__/lib/book-studio/capabilities.test.ts
import {
  resolveBookStudioCapabilities,
  portalActionForRequest,
} from '@/lib/book-studio/capabilities'

const settingsWith = (actions: Record<string, Record<string, boolean>>) => ({
  modulePolicies: { bookStudio: { actions } },
})

describe('resolveBookStudioCapabilities', () => {
  it('defaults every action to true when no policy is stored', () => {
    const caps = resolveBookStudioCapabilities(undefined, 'member', false)
    expect(caps).toMatchObject({
      canView: true, canCreate: true, canEdit: true,
      canEvidenceRights: true, canApprovalGates: true,
      canPublishingPackets: true, canArchiveDelete: true, isOperator: false,
    })
  })

  it('honours per-role toggles', () => {
    const settings = settingsWith({
      create: { owner: true, admin: true, member: false },
      edit: { owner: true, admin: true, member: false },
    })
    const caps = resolveBookStudioCapabilities(settings, 'member', false)
    expect(caps.canCreate).toBe(false)
    expect(caps.canEdit).toBe(false)
    expect(caps.canView).toBe(true) // untouched action stays default-true
  })

  it('operator override forces everything true', () => {
    const settings = settingsWith({ create: { owner: false, admin: false, member: false } })
    const caps = resolveBookStudioCapabilities(settings, 'member', true)
    expect(caps.canCreate).toBe(true)
    expect(caps.isOperator).toBe(true)
  })

  it('unknown role normalizes to member', () => {
    const settings = settingsWith({ edit: { owner: true, admin: true, member: false } })
    expect(resolveBookStudioCapabilities(settings, 'weird', false).canEdit).toBe(false)
  })
})

describe('portalActionForRequest', () => {
  it('maps reads by resource', () => {
    expect(portalActionForRequest('GET', 'projects', {})).toBe('canView')
    expect(portalActionForRequest('GET', 'publishing-packets', {})).toBe('canPublishingPackets')
    expect(portalActionForRequest('GET', 'package-manifests', {})).toBe('canPublishingPackets')
    expect(portalActionForRequest('GET', 'rights-ledgers', {})).toBe('canEvidenceRights')
    expect(portalActionForRequest('GET', 'artifact-links', {})).toBe('canEvidenceRights')
  })

  it('maps writes by resource', () => {
    expect(portalActionForRequest('POST', 'projects', {})).toBe('canCreate')
    expect(portalActionForRequest('POST', 'series', {})).toBe('canCreate')
    expect(portalActionForRequest('POST', 'chapters', {})).toBe('canEdit')
    expect(portalActionForRequest('PATCH', 'pages', {})).toBe('canEdit')
    expect(portalActionForRequest('POST', 'artifact-links', {})).toBe('canEvidenceRights')
  })

  it('escalates approval and delete', () => {
    expect(portalActionForRequest('PATCH', 'chapters', { status: 'approved' })).toBe('canApprovalGates')
    expect(portalActionForRequest('PATCH', 'projects', { deleted: true })).toBe('canArchiveDelete')
  })

  it('denies operator-only and internal resources', () => {
    expect(portalActionForRequest('POST', 'publishing-packets', {})).toBeNull()
    expect(portalActionForRequest('POST', 'package-manifests', {})).toBeNull()
    expect(portalActionForRequest('GET', 'decision-logs', {})).toBeNull()
    expect(portalActionForRequest('GET', 'analytics-imports', {})).toBeNull()
  })
})
