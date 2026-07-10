import { canAccessHermesProfile, sanitizeHermesCapabilities } from '@/lib/hermes/access'
import type { ApiUser } from '@/lib/api/types'
import type { HermesProfileLink } from '@/lib/hermes/types'

const baseLink: HermesProfileLink = {
  orgId: 'org-a',
  profile: 'client-a',
  baseUrl: 'http://127.0.0.1:8651',
  enabled: true,
  capabilities: {
    runs: true,
    dashboard: true,
    cron: true,
    models: true,
    tools: true,
    files: true,
    terminal: true,
  },
  permissions: {
    superAdmin: true,
    restrictedAdmin: true,
    client: false,
    allowedUserIds: [],
  },
}

describe('canAccessHermesProfile', () => {
  it('allows super admins to access every enabled profile', () => {
    const user: ApiUser = { uid: 'super-1', role: 'admin' }
    expect(canAccessHermesProfile(user, baseLink, 'runs')).toEqual({ allowed: true })
  })

  it('allows restricted admins only when their allowedOrgIds contains the profile org', () => {
    const user: ApiUser = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-a'] }
    expect(canAccessHermesProfile(user, baseLink, 'dashboard')).toEqual({ allowed: true })

    const denied: ApiUser = { uid: 'admin-2', role: 'admin', allowedOrgIds: ['org-b'] }
    expect(canAccessHermesProfile(denied, baseLink, 'dashboard')).toMatchObject({ allowed: false, status: 403 })
  })

  it('allows clients only when the client switch or explicit user permission is enabled', () => {
    const client: ApiUser = { uid: 'client-1', role: 'client', orgId: 'org-a' }
    expect(canAccessHermesProfile(client, baseLink, 'runs')).toMatchObject({ allowed: false, status: 403 })

    expect(
      canAccessHermesProfile(client, {
        ...baseLink,
        permissions: { ...baseLink.permissions, client: true },
      }, 'runs'),
    ).toEqual({ allowed: true })

    expect(
      canAccessHermesProfile(client, {
        ...baseLink,
        permissions: { ...baseLink.permissions, allowedUserIds: ['client-1'] },
      }, 'runs'),
    ).toEqual({ allowed: true })
  })

  it('denies legacy and per-agent AI credentials on legacy profile aliases', () => {
    const legacy: ApiUser = { uid: 'ai-agent', role: 'ai', authKind: 'legacy_ai_key' }
    const scoped: ApiUser = {
      uid: 'agent-api-key:key-1',
      role: 'ai',
      authKind: 'agent_api_key',
      agentId: 'pip',
      orgId: 'org-a',
    }
    expect(canAccessHermesProfile(legacy, baseLink, 'runs')).toMatchObject({ allowed: false, status: 403 })
    expect(canAccessHermesProfile(scoped, baseLink, 'runs')).toMatchObject({ allowed: false, status: 403 })
  })

  it('blocks disabled profiles and disabled capabilities', () => {
    const user: ApiUser = { uid: 'super-1', role: 'admin' }
    expect(canAccessHermesProfile(user, { ...baseLink, enabled: false }, 'runs')).toMatchObject({ allowed: false, status: 409 })
    expect(
      canAccessHermesProfile(user, {
        ...baseLink,
        capabilities: { ...baseLink.capabilities, terminal: false },
      }, 'terminal'),
    ).toMatchObject({ allowed: false, status: 403 })
  })
})

describe('sanitizeHermesCapabilities', () => {
  it('defaults side-effect capabilities on but lets each be switched off', () => {
    expect(sanitizeHermesCapabilities(undefined)).toEqual({
      runs: true,
      dashboard: true,
      cron: true,
      models: true,
      tools: true,
      files: true,
      terminal: true,
    })
    expect(sanitizeHermesCapabilities({ terminal: false, files: false })).toMatchObject({
      runs: true,
      files: false,
      terminal: false,
    })
  })
})
