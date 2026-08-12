import fs from 'node:fs'
import path from 'node:path'

const servicePath = path.join(process.cwd(), 'lib/cross-org/policy-service.ts')
const routePath = path.join(process.cwd(), 'app/api/v1/cross-org/decide/route.ts')

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('cross-org policy service architecture contract (task YKa9DWMexJ8Cx3yuRdgz)', () => {
  it('publishes the central policy decision service module', () => {
    expect(fs.existsSync(servicePath)).toBe(true)
  })

  it('exports the service, store contract, reason codes and safe projections', () => {
    const service = read(servicePath)
    for (const exportName of [
      'CrossOrgPolicyService',
      'CrossOrgPolicyStore',
      'FirestoreCrossOrgPolicyStore',
      'InMemoryCrossOrgPolicyStore',
      'createCrossOrgPolicyService',
      'reasonCodeFromDecision',
      'buildSafeProjection',
      'projectResourceRecord',
      'hashPartnerAuditEvent',
    ]) {
      expect(service).toContain(exportName)
    }
    expect(service).toContain('access.decided')
    expect(service).toContain('reconciliationKey')
  })

  it('requires the full decision chain in the service path', () => {
    const service = read(servicePath)
    expect(service).toContain('evaluatePartnerAccess')
    expect(service).toContain('loadActiveOrgMember')
    expect(service).toContain('evaluateExpiry')
    expect(service).toContain('reciprocal_link')
    expect(service).toContain('resource_grant')
    expect(service).toContain('lifecycle')
  })

  it('emits append-only audit events without foreign data', () => {
    const service = read(servicePath)
    expect(service).toContain('PARTNER_AUDIT_EVENTS_COLLECTION')
    expect(service).toContain('FieldValue.serverTimestamp()')
    expect(service).toContain('appendAuditEvent')
    // The event builder records ids/decision/reason only; never a payload.
    expect(service).toContain('actorOrgId: orgId')
    expect(service).not.toContain('secretField')
  })

  it('publishes the tenant-safe audit decision API route', () => {
    expect(fs.existsSync(routePath)).toBe(true)
    const route = read(routePath)
    expect(route).toContain('withCrmAuth')
    expect(route).toContain('createCrossOrgPolicyService')
    expect(route).toContain('apiSuccess')
    // Actor org/user come from the auth context — never from the body.
    expect(route).toContain('ctx.orgId')
    expect(route).toContain('ctx.actor')
    expect(route).toContain('resourceType is required')
    expect(route).toContain('action is required')
  })
})
