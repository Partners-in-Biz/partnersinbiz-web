import { buildMobileAppWorkspaceModel } from '@/lib/chat-context/adapters/mobileApps'
import { parseStudioArtifactContextId } from '@/lib/chat-context/studioArtifactIdentity'
import type { MobileAppRecord } from '@/lib/mobile-apps/types'

const app: MobileAppRecord & { id: string } = {
  id: 'app-1', orgId: 'org-1', name: 'Growth Pocket', platform: 'ios', status: 'planned',
  appStoreUrl: 'https://apps.apple.com/app/growth-pocket', developerName: 'Growth Labs',
  assets: { iconUrl: 'https://cdn.test/icon.png', screenshotUrls: ['https://cdn.test/1.png', 'https://cdn.test/2.png'] },
  listing: { title: 'Growth Pocket', subtitle: 'Run growth anywhere', shortDescription: 'A useful app.' },
  access: { accessStatus: 'invited', accessNotes: 'Owner must accept the invitation.' },
  profileLinks: [{ id: 'analytics', type: 'analytics', label: 'App analytics', url: 'https://analytics.test/app', status: 'linked' }],
  analyticsSnapshot: { installs: 120, activeUsers: 44, averageRating: 4.7, reviewCount: 12, lastUpdatedAt: '2026-07-12T10:00:00Z' },
  releaseManagement: { currentVersion: '1.2.0', upcomingVersion: '1.3.0', submissionStatus: 'ready_for_submission', knownIssues: 'Store privacy answers required.' },
  clientNotes: 'Confirm the launch countries.', internalNotes: 'secret admin note',
}

describe('Mobile Apps chat context mapping', () => {
  it('rejects an unknown Studio kind in an otherwise valid canonical identity', () => {
    expect(parseStudioArtifactContextId('unknown_studio:org:b3JnLTE:app:YXBwLTE')).toBeNull()
  })
  it('projects an app workspace rather than a media generator', () => {
    const model = buildMobileAppWorkspaceModel({ app, role: 'admin', orgSlug: 'growth-labs', now: new Date('2026-07-13T10:00:00Z') })
    expect(model.context).toEqual(expect.objectContaining({ id: 'mobile_apps:org:b3JnLTE:app:YXBwLTE', orgId: 'org-1', icon: 'mobile_apps', href: '/admin/org/growth-labs/mobile-apps?appId=app-1' }))
    expect(model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'platform', value: 'iOS' }),
      expect.objectContaining({ id: 'listing-assets', value: 3 }),
      expect.objectContaining({ id: 'analytics-age', value: '1d' }),
    ]))
    expect(model.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'listing-assets' }), expect.objectContaining({ id: 'links' }), expect.objectContaining({ id: 'release' }),
    ]))
    expect(model.artifacts).toEqual([expect.objectContaining({ artifactKind: 'app_asset', preview: { kind: 'image', url: 'https://cdn.test/icon.png' } })])
    expect(model.artifacts.flatMap((item) => item.actions).some((action) => action.id.includes('generate'))).toBe(false)
  })

  it('surfaces access, release, known issue, and requested client input as attention', () => {
    const model = buildMobileAppWorkspaceModel({ app, role: 'client', now: new Date('2026-07-13T10:00:00Z') })
    expect(model.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'access:app-1', state: 'needs_input' }),
      expect.objectContaining({ id: 'release:app-1', state: 'needs_approval' }),
      expect.objectContaining({ id: 'issues:app-1', state: 'blocked' }),
      expect.objectContaining({ id: 'client-input:app-1', state: 'needs_input' }),
    ]))
  })

  it('keeps submission, release, access changes, and destructive actions gated', () => {
    const model = buildMobileAppWorkspaceModel({ app, role: 'admin', now: new Date('2026-07-13T10:00:00Z') })
    const actions = model.artifacts.flatMap((item) => item.actions)
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'submit', requiresApproval: true }),
      expect.objectContaining({ id: 'change-access', requiresApproval: true }),
      expect.objectContaining({ id: 'deprecate', requiresApproval: true, destructive: true }),
    ]))
    expect(actions.find((action) => action.id === 'submit')?.method).toBeUndefined()
    expect(actions.find((action) => action.id === 'deprecate')?.method).toBeUndefined()
  })

  it('uses a bounded safe projection and never exposes private notes or account identifiers', () => {
    const oversized = {
      ...app,
      name: ` App ${'x'.repeat(300)} `,
      assets: { ...app.assets, screenshotUrls: Array.from({ length: 40 }, (_, index) => `https://cdn.test/${index}.png`) },
      profileLinks: Array.from({ length: 20 }, (_, index) => ({ id: `id-${'x'.repeat(200)}-${index}`, type: 'other' as const, label: `Label ${'x'.repeat(300)}`, url: index === 0 ? `https://example.test/${'x'.repeat(3000)}` : `https://example.test/${index}`, status: 'linked' as const })),
      releaseManagement: { ...app.releaseManagement, currentVersion: 'v'.repeat(200), upcomingVersion: 'u'.repeat(200) },
      access: { accessStatus: 'blocked' as const, appleDeveloperAccount: 'private-account', accessNotes: 'contains secret' },
    }
    const model = buildMobileAppWorkspaceModel({ app: oversized, role: 'client', now: new Date('2026-07-13T10:00:00Z') })
    expect(model.groups.find((group) => group.id === 'listing-assets')?.items.length).toBeLessThanOrEqual(12)
    expect(model.groups.find((group) => group.id === 'links')?.items.length).toBeLessThanOrEqual(10)
    expect(model.context.label.length).toBeLessThanOrEqual(160)
    expect(model.pulse.headline?.length).toBeLessThanOrEqual(96)
    expect(JSON.stringify(model)).not.toContain('https://example.test/xxx')
    expect(JSON.stringify(model)).not.toContain('secret admin note')
    expect(JSON.stringify(model)).not.toContain('private-account')
    expect(JSON.stringify(model)).not.toContain('contains secret')
  })

  it('honours client analytics and release visibility and rejects unsafe external links', () => {
    const restricted = {
      ...app,
      appStoreUrl: 'javascript:alert(1)',
      visibility: { showInClientPortal: true, showAnalytics: false, showReleaseNotes: false },
    }
    const model = buildMobileAppWorkspaceModel({ app: restricted, role: 'client', now: new Date('2026-07-13T10:00:00Z') })
    expect(model.groups.some((group) => group.id === 'analytics')).toBe(false)
    expect(model.groups.some((group) => group.id === 'release')).toBe(false)
    expect(JSON.stringify(model)).not.toContain('javascript:')
  })

  it('rejects remote HTTP links but permits localhost development links', () => {
    const model = buildMobileAppWorkspaceModel({
      app: {
        ...app,
        appStoreUrl: 'http://remote.example.test/app',
        supportUrl: 'http://localhost:3000/support',
        websiteUrl: 'http://127.0.0.1:4000/app',
      },
      role: 'client',
    })
    const links = model.groups.find((group) => group.id === 'links')?.items ?? []
    expect(links.map((link) => link.href)).toEqual(expect.arrayContaining([
      'http://localhost:3000/support',
      'http://127.0.0.1:4000/app',
    ]))
    expect(JSON.stringify(links)).not.toContain('remote.example.test')
  })
})
