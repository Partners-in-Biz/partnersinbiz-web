import * as fs from 'node:fs'
import * as path from 'node:path'
import { NextRequest } from 'next/server'

import { resolveOrgScope } from '@/lib/api/orgScope'
import { resolveOrgId } from '@/lib/workspace-os/api'
import type { ApiUser } from '@/lib/api/types'

const repoRoot = process.cwd()
const source = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

const multiOrgClient: ApiUser = {
  uid: 'client-1',
  role: 'client',
  orgId: 'org-default',
  activeOrgId: 'org-selected',
  orgIds: ['org-default', 'org-selected'],
}

describe('selected organisation context rollout', () => {
  it('defaults client workspace routes to activeOrgId when orgId is omitted', () => {
    const scope = resolveOrgScope(multiOrgClient, null)

    expect(scope).toMatchObject({ ok: true, orgId: 'org-selected' })
  })

  it('keeps explicit requested orgs authoritative and rejects inaccessible orgs', () => {
    expect(resolveOrgScope(multiOrgClient, 'org-default')).toMatchObject({ ok: true, orgId: 'org-default' })
    expect(resolveOrgScope(multiOrgClient, 'org-outside')).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('keeps CRM scoped routes classified away from selected-org defaults', () => {
    const auditMap = source('docs/selected-organisation-context-audit-map.md')
    const crmMiddleware = source('lib/auth/crm-middleware.ts')

    expect(auditMap).toContain('CRM company/contact/deal views | CRM-scoped | crmScopeOrgId')
    expect(crmMiddleware).not.toContain('resolveSelectedOrgContext')
  })

  it('resolves workspace OS folders, artifacts, uploads, and broker helpers through selected org scope', () => {
    const req = new NextRequest('http://localhost/api/v1/workspace-artifacts')
    expect(resolveOrgId(req, multiOrgClient)).toMatchObject({ orgId: 'org-selected', mismatch: false })

    const explicitReq = new NextRequest('http://localhost/api/v1/workspace-artifacts?orgId=org-default')
    expect(resolveOrgId(explicitReq, multiOrgClient)).toMatchObject({ orgId: 'org-default', mismatch: false })

    const deniedReq = new NextRequest('http://localhost/api/v1/workspace-artifacts?orgId=org-outside')
    expect(resolveOrgId(deniedReq, multiOrgClient)).toMatchObject({ orgId: null, status: 403 })
  })

  it('applies selected-org defaults to agent chat, Projects/Kanban, documents, inbox, notifications, and reports', () => {
    const expectations: Array<[string, RegExp]> = [
      ['app/api/v1/conversations/route.ts', /resolveOrgScope\(user, requestedOrgId\)/],
      ['app/api/v1/projects/route.ts', /resolveOrgScope\(user, searchParams\.get\('orgId'\)\)/],
      ['app/api/v1/client-documents/route.ts', /resolveOrgScope\(user, requestedOrgId\)/],
      ['app/api/v1/inbox/route.ts', /resolveOrgScope\(user, searchParams\.get\('orgId'\)\)/],
      ['app/api/v1/notifications/route.ts', /resolveOrgScope\(user, searchParams\.get\('orgId'\)\)/],
      ['app/api/v1/reports/route.ts', /resolveOrgScope\(user, url\.searchParams\.get\('orgId'\)\)/],
      ['app/api/v1/reports/activity-summary/route.ts', /resolveOrgScope\(user, searchParams\.get\('orgId'\)\)/],
      ['app/api/v1/reports/revenue/route.ts', /resolveOrgScope\(user, searchParams\.get\('orgId'\)\)/],
    ]

    for (const [file, pattern] of expectations) {
      expect(source(file)).toMatch(pattern)
    }
  })
})
