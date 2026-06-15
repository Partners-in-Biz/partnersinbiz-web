// __tests__/lib/orgScope.test.ts
import { resolveOrgScope } from '@/lib/api/orgScope'
import {
  SELECTED_ORG_CONTEXT_AUDIT_MAP,
  resolveSelectedOrgContext,
} from '@/lib/api/selectedOrgContext'
import type { ApiUser } from '@/lib/api/types'
import { isSuperAdmin, isRestrictedAdmin } from '@/lib/api/platformAdmin'

describe('resolveOrgScope', () => {
  describe('client role', () => {
    it('prefers activeOrgId over user.orgId when no override is supplied', () => {
      const user: ApiUser = {
        uid: 'u1',
        role: 'client',
        orgId: 'default-org',
        activeOrgId: 'selected-org',
        orgIds: ['default-org', 'selected-org'],
      }
      const r = resolveOrgScope(user, null)
      expect(r).toEqual({ ok: true, orgId: 'selected-org' })
    })

    it('falls back to user.orgId when no active org is selected', () => {
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



describe('resolveSelectedOrgContext', () => {
  it('returns selected-org-aware client context when activeOrgId differs from the default org', () => {
    const result = resolveSelectedOrgContext({
      uid: 'u1',
      role: 'client',
      orgId: 'default-org',
      activeOrgId: 'selected-org',
      orgIds: ['default-org', 'selected-org'],
    })

    expect(result).toEqual({
      ok: true,
      orgId: 'selected-org',
      source: 'activeOrgId',
      selectedOrgId: 'selected-org',
      defaultOrgId: 'default-org',
      accessibleOrgIds: ['default-org', 'selected-org'],
    })
  })

  it('ignores an inaccessible activeOrgId and falls back to the default org', () => {
    const result = resolveSelectedOrgContext({
      uid: 'u1',
      role: 'client',
      orgId: 'default-org',
      activeOrgId: 'other-org',
      orgIds: ['default-org'],
    })

    expect(result).toEqual({
      ok: true,
      orgId: 'default-org',
      source: 'defaultOrgId',
      selectedOrgId: 'other-org',
      defaultOrgId: 'default-org',
      accessibleOrgIds: ['default-org'],
    })
  })

  it('keeps admin workspace context explicit instead of silently falling back', () => {
    const result = resolveSelectedOrgContext({ uid: 'admin', role: 'admin', orgId: 'pib-platform-owner' })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'orgId is required (admin role must scope explicitly)',
    })
  })
})

describe('selected organisation context audit map', () => {
  it('classifies required rollout surfaces', () => {
    expect(SELECTED_ORG_CONTEXT_AUDIT_MAP).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: 'agent-chat-and-runs', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'projects-kanban', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'client-documents', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'workspace-files-artifacts', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'briefings-inbox-notifications', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'reports-dashboards', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'support', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'social-content-seo-ads', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'research-intelligence', classification: 'selected-org-aware' }),
        expect.objectContaining({ surface: 'crm-company-contact-deal-views', classification: 'CRM-scoped' }),
        expect.objectContaining({ surface: 'crm-company-invoices', classification: 'CRM-scoped' }),
        expect.objectContaining({ surface: 'platform-admin-settings', classification: 'intentionally global' }),
        expect.objectContaining({ surface: 'public-tokenized-links', classification: 'not applicable' }),
      ]),
    )
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
