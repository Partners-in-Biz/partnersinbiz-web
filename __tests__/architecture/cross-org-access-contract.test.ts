import fs from 'node:fs'
import path from 'node:path'

const adrPath = path.join(process.cwd(), 'docs/architecture/cross-org-access-model.md')
const typesPath = path.join(process.cwd(), 'lib/cross-org/types.ts')
const decisionPath = path.join(process.cwd(), 'lib/cross-org/decision.ts')
const lifecyclePath = path.join(process.cwd(), 'lib/cross-org/lifecycle.ts')
const migrationPath = path.join(process.cwd(), 'lib/cross-org/migration.ts')

function adr(): string {
  return fs.readFileSync(adrPath, 'utf8')
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('cross-org access model architecture contract (ADR RBa6Ykx9AbBFrkrX5sAg)', () => {
  it('publishes the implementation-ready ADR document', () => {
    expect(fs.existsSync(adrPath)).toBe(true)
    expect(adr()).toContain('Cross-organisation collaboration and resource access model')
  })

  it('records the canonical decision chain and source spec', () => {
    const content = adr()
    expect(content).toContain('9EllFp0EYw7MVkn89jbB')
    expect(content).toContain('actor')
    expect(content).toContain('active membership')
    expect(content).toContain('reciprocal live partner link')
    expect(content).toContain('resource grant')
    expect(content).toContain('action/field')
    expect(content).toContain('lifecycle state')
  })

  it('defines all five canonical contracts and collections', () => {
    const content = adr()
    const types = read(typesPath)
    for (const contract of [
      'PartnerLink',
      'PartnerScopeAgreement',
      'PartnerResourceGrant',
      'PartnerIdentityLink',
      'PartnerAuditEvent',
    ]) {
      expect(content).toContain(contract)
      expect(types).toContain(contract)
    }
    for (const collection of [
      'partnerLinks',
      'partnerScopeAgreements',
      'partnerResourceGrants',
      'partnerIdentityLinks',
      'partnerAuditEvents',
    ]) {
      expect(content).toContain(collection)
    }
  })

  it('keeps legacy convenience pointers as read-only compatibility inputs', () => {
    const content = adr()
    expect(content).toContain('linkedOrgId')
    expect(content).toContain('linkedUserId')
    expect(content).toContain('never grant access')
  })

  it('declares the server-only collection access posture', () => {
    const content = adr()
    expect(content).toContain('Server-only')
    expect(content).toContain('append-only')
  })

  it('exports the pure decision evaluator', () => {
    const decision = read(decisionPath)
    expect(decision).toContain('evaluatePartnerAccess')
    expect(decision).toContain('active_membership')
    expect(decision).toContain('reciprocal_link')
    expect(decision).toContain('resource_grant')
    expect(decision).toContain('action_field')
    expect(decision).toContain('lifecycle')
  })

  it('exports lifecycle cascade planners and expiry evaluation', () => {
    const lifecycle = read(lifecyclePath)
    expect(lifecycle).toContain('planLinkUnlinkCascade')
    expect(lifecycle).toContain('planCapabilityReductionCascade')
    expect(lifecycle).toContain('evaluateExpiry')
  })

  it('exports migration compatibility helpers', () => {
    const migration = read(migrationPath)
    expect(migration).toContain('extractLegacyPointers')
    expect(migration).toContain('promoteActiveRelationshipPair')
    expect(migration).toContain('promoteShareToResourceGrant')
    expect(migration).toContain('seedIdentityLinksFromPointers')
  })
})
