// __tests__/lib/orgScope.test.ts
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import { isSuperAdmin, isRestrictedAdmin } from '@/lib/api/platformAdmin'

describe('resolveOrgScope', () => {
  describe('client role', () => {
    it('forces orgId to user.orgId when no override is supplied', () => {
      const user: ApiUser = { uid: 'u1', role: 'client', orgId: 'org-a' }
      const r = resolveOrgScope(user, null)
      expect(r).toEqual({ ok: true, orgId: 'org-a' })
    })

    it('returns 403 when client tries to access a different org', () => {
      const user: ApiUser = { uid: 'u1', role: 'client', orgId: 'org-a' }
      const r = resolveOrgScope(user, 'org-b')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(403)
    })

    it('returns 403 when client has no orgId', () => {
      const user: ApiUser = { uid: 'u1', role: 'client' }
      const r = resolveOrgScope(user, null)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(403)
    })
  })

  describe('admin role — super admin (no allowedOrgIds)', () => {
    it('can access any orgId', () => {
      const user: ApiUser = { uid: 'a1', role: 'admin' }
      expect(resolveOrgScope(user, 'any-org')).toEqual({ ok: true, orgId: 'any-org' })
    })

    it('can access any orgId with empty allowedOrgIds array', () => {
      const user: ApiUser = { uid: 'a1', role: 'admin', allowedOrgIds: [] }
      expect(resolveOrgScope(user, 'any-org')).toEqual({ ok: true, orgId: 'any-org' })
    })

    it('returns 400 when no orgId is supplied', () => {
      const user: ApiUser = { uid: 'a1', role: 'admin' }
      const r = resolveOrgScope(user, null)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(400)
    })
  })

  describe('admin role — restricted (allowedOrgIds set)', () => {
    it('grants access to orgs in the allowedOrgIds list', () => {
      const user: ApiUser = {
        uid: 'a1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a', 'org-b'],
      }
      expect(resolveOrgScope(user, 'org-a')).toEqual({ ok: true, orgId: 'org-a' })
      expect(resolveOrgScope(user, 'org-b')).toEqual({ ok: true, orgId: 'org-b' })
    })

    it('denies access to orgs not in the allowedOrgIds list', () => {
      const user: ApiUser = {
        uid: 'a1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a', 'org-b'],
      }
      const r = resolveOrgScope(user, 'org-c')
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.status).toBe(403)
        expect(r.error).toMatch(/do not have access/i)
      }
    })

    it('always allows access to the admin\'s home orgId even if not in list', () => {
      const user: ApiUser = {
        uid: 'a1',
        role: 'admin',
        orgId: 'pib-platform-owner',
        allowedOrgIds: ['org-a'],
      }
      // pib-platform-owner is the home org and should be implicitly allowed.
      expect(resolveOrgScope(user, 'pib-platform-owner')).toEqual({
        ok: true,
        orgId: 'pib-platform-owner',
      })
    })

    it('allows restricted admins into the internal platform workspace even for older users without orgId', () => {
      const user: ApiUser = {
        uid: 'a1',
        role: 'admin',
        allowedOrgIds: ['org-a'],
      }

      expect(resolveOrgScope(user, 'pib-platform-owner')).toEqual({
        ok: true,
        orgId: 'pib-platform-owner',
      })
    })
  })

  describe('ai role', () => {
    it('can access any orgId, regardless of allowedOrgIds', () => {
      const user: ApiUser = { uid: 'ai-agent', role: 'ai' }
      expect(resolveOrgScope(user, 'org-z')).toEqual({ ok: true, orgId: 'org-z' })
    })
  })
})

describe('isSuperAdmin / isRestrictedAdmin', () => {
  it('treats admin without allowedOrgIds as super admin', () => {
    const u: ApiUser = { uid: 'a', role: 'admin' }
    expect(isSuperAdmin(u)).toBe(true)
    expect(isRestrictedAdmin(u)).toBe(false)
  })

  it('treats admin with empty allowedOrgIds as super admin', () => {
    const u: ApiUser = { uid: 'a', role: 'admin', allowedOrgIds: [] }
    expect(isSuperAdmin(u)).toBe(true)
    expect(isRestrictedAdmin(u)).toBe(false)
  })

  it('treats admin with non-empty allowedOrgIds as restricted', () => {
    const u: ApiUser = { uid: 'a', role: 'admin', allowedOrgIds: ['org-a'] }
    expect(isSuperAdmin(u)).toBe(false)
    expect(isRestrictedAdmin(u)).toBe(true)
  })

  it('treats clients as neither super nor restricted admin', () => {
    const u: ApiUser = { uid: 'c', role: 'client', orgId: 'org-a' }
    expect(isSuperAdmin(u)).toBe(false)
    expect(isRestrictedAdmin(u)).toBe(false)
  })

  it('treats ai role as super admin', () => {
    const u: ApiUser = { uid: 'ai', role: 'ai' }
    expect(isSuperAdmin(u)).toBe(true)
    expect(isRestrictedAdmin(u)).toBe(false)
  })

  it('handles null/undefined gracefully', () => {
    expect(isSuperAdmin(null)).toBe(false)
    expect(isSuperAdmin(undefined)).toBe(false)
    expect(isRestrictedAdmin(null)).toBe(false)
    expect(isRestrictedAdmin(undefined)).toBe(false)
  })
})
