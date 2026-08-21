/**
 * Workspace isolation test for resolveOrgScope helper.
 *
 * Security requirement: 100% org isolation. Active portal workspace is the ONLY tenant.
 * Platform admins in a client workspace must NOT see data from other orgs.
 *
 * This helper is used by:
 * - /api/v1/client-documents
 * - Other routes using withAuth('client') that support both admin and client roles
 *
 * RULE: Active portal workspace (activeOrgId) is the only accessible org.
 * Platform-admin identity must not leak into client workspace.
 */
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'

// Mock canAccessOrg to allow access to test orgs
jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn((user: ApiUser, orgId: string) => {
    // Unrestricted platform admin can access any org
    if (user.role === 'admin' && !user.allowedOrgIds) return true
    // Restricted admin can only access allowedOrgIds
    if (user.role === 'admin' && user.allowedOrgIds) {
      return user.allowedOrgIds.includes(orgId)
    }
    // Client can access their orgIds
    if (user.role === 'client') {
      const userOrgs = [user.orgId, user.activeOrgId, ...(user.orgIds || [])].filter(Boolean)
      return userOrgs.includes(orgId)
    }
    // AI can access any org
    return user.role === 'ai'
  }),
}))

jest.mock('@/lib/api/selectedOrgContext', () => ({
  resolveSelectedOrgContext: jest.fn((user: ApiUser, requestedOrgId: string | null) => {
    const activeOrg = user.activeOrgId || user.orgId || user.orgIds?.[0]
    if (!activeOrg) {
      return { ok: false, status: 400, error: 'No active organisation' }
    }
    if (requestedOrgId && requestedOrgId !== activeOrg) {
      return { ok: false, status: 403, error: 'Cannot access a different organisation' }
    }
    return { ok: true, orgId: activeOrg }
  }),
}))

describe('resolveOrgScope — workspace isolation for dual-role platform owners', () => {
  it('platform admin in portal workspace (activeOrgId) is scoped to that workspace', () => {
    const user: ApiUser = {
      uid: 'stean',
      role: 'admin',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
    }

    // No orgId param: should default to activeOrgId
    const result1 = resolveOrgScope(user, null)
    expect(result1.ok).toBe(true)
    if (result1.ok) {
      expect(result1.orgId).toBe('humanaut-org')
    }

    // Matching orgId param: should succeed
    const result2 = resolveOrgScope(user, 'humanaut-org')
    expect(result2.ok).toBe(true)
    if (result2.ok) {
      expect(result2.orgId).toBe('humanaut-org')
    }

    // Different orgId param: should be rejected
    const result3 = resolveOrgScope(user, 'pib-platform-owner')
    expect(result3.ok).toBe(false)
    if (!result3.ok) {
      expect(result3.status).toBe(403)
      expect(result3.error).toContain('different organisation')
    }

    // Unrelated org: should be rejected
    const result4 = resolveOrgScope(user, 'saaiman-org')
    expect(result4.ok).toBe(false)
    if (!result4.ok) {
      expect(result4.status).toBe(403)
    }
  })

  it('platform admin WITHOUT activeOrgId can query any org (API/cron usage)', () => {
    const user: ApiUser = {
      uid: 'system-admin',
      role: 'admin',
      orgId: 'pib-platform-owner',
      // No activeOrgId = not in portal workspace context
    }

    // Can access any org with explicit param
    const result1 = resolveOrgScope(user, 'humanaut-org')
    expect(result1.ok).toBe(true)
    if (result1.ok) {
      expect(result1.orgId).toBe('humanaut-org')
    }

    const result2 = resolveOrgScope(user, 'saaiman-org')
    expect(result2.ok).toBe(true)
    if (result2.ok) {
      expect(result2.orgId).toBe('saaiman-org')
    }

    // No orgId param: should require explicit org
    const result3 = resolveOrgScope(user, null)
    expect(result3.ok).toBe(false)
    if (!result3.ok) {
      expect(result3.status).toBe(400)
      expect(result3.error).toContain('orgId is required')
    }
  })

  it('client user in portal workspace is scoped to their org', () => {
    const user: ApiUser = {
      uid: 'humanaut-owner',
      role: 'client',
      orgId: 'humanaut-org',
      activeOrgId: 'humanaut-org',
      orgIds: ['humanaut-org'],
    }

    // No orgId param: should default to activeOrgId
    const result1 = resolveOrgScope(user, null)
    expect(result1.ok).toBe(true)
    if (result1.ok) {
      expect(result1.orgId).toBe('humanaut-org')
    }

    // Matching orgId param: should succeed
    const result2 = resolveOrgScope(user, 'humanaut-org')
    expect(result2.ok).toBe(true)
    if (result2.ok) {
      expect(result2.orgId).toBe('humanaut-org')
    }

    // Different orgId param: should be rejected
    const result3 = resolveOrgScope(user, 'pib-platform-owner')
    expect(result3.ok).toBe(false)
    if (!result3.ok) {
      expect(result3.status).toBe(403)
    }
  })

  it('dual-role user switching workspace switches the dataset', () => {
    // Peet in Humanaut workspace
    const peetInHumanaut: ApiUser = {
      uid: 'peet',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
    }

    const result1 = resolveOrgScope(peetInHumanaut, null)
    expect(result1.ok).toBe(true)
    if (result1.ok) {
      expect(result1.orgId).toBe('humanaut-org')
    }

    // Peet in PiB workspace
    const peetInPiB: ApiUser = {
      uid: 'peet',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner', 'humanaut-org'],
    }

    const result2 = resolveOrgScope(peetInPiB, null)
    expect(result2.ok).toBe(true)
    if (result2.ok) {
      expect(result2.orgId).toBe('pib-platform-owner')
    }

    // Switching workspace switches the dataset
    expect(result1.ok && result2.ok && result1.orgId !== result2.orgId).toBe(true)
  })

  it('restricted platform admin in portal workspace is scoped to that workspace', () => {
    const user: ApiUser = {
      uid: 'support-admin',
      role: 'admin',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
      allowedOrgIds: ['humanaut-org', 'client-b'],
    }

    // Should be scoped to activeOrgId (humanaut-org)
    const result = resolveOrgScope(user, null)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.orgId).toBe('humanaut-org')
    }

    // Cannot access other allowed org when in portal workspace
    const result2 = resolveOrgScope(user, 'client-b')
    expect(result2.ok).toBe(false)
    if (!result2.ok) {
      expect(result2.status).toBe(403)
      expect(result2.error).toContain('different organisation')
    }
  })

  it('AI agent in portal workspace is scoped to that workspace', () => {
    const user: ApiUser = {
      uid: 'agent:theo',
      role: 'ai',
      orgId: 'pib-platform-owner',
      activeOrgId: 'humanaut-org',
    }

    // AI agents in portal context are scoped to activeOrgId
    const result = resolveOrgScope(user, null)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.orgId).toBe('humanaut-org')
    }

    // Cannot access different org when in portal workspace
    const result2 = resolveOrgScope(user, 'saaiman-org')
    expect(result2.ok).toBe(false)
    if (!result2.ok) {
      expect(result2.status).toBe(403)
    }
  })
})
