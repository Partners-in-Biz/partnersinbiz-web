import fs from 'node:fs'
import path from 'node:path'

const adapterPath = path.join(process.cwd(), 'lib/cross-org/prejoin-resource-adapter.ts')
const storePath = path.join(process.cwd(), 'lib/cross-org/prejoin-resource-store.ts')
const ownerPath = path.join(process.cwd(), 'lib/cross-org/prejoin-resource-owner.ts')
const httpPath = path.join(process.cwd(), 'lib/cross-org/prejoin-resource-http.ts')
const issueRoute = path.join(process.cwd(), 'app/api/v1/cross-org/prejoin-invitations/route.ts')
const claimRoute = path.join(process.cwd(), 'app/api/v1/cross-org/prejoin-invitations/claim/route.ts')
const activateRoute = path.join(process.cwd(), 'app/api/v1/cross-org/prejoin-invitations/[id]/activate/route.ts')

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('cross-org prejoin invitation owning-route architecture contract', () => {
  it('publishes adapter, store, owner lookup, http helpers and owning routes', () => {
    for (const file of [adapterPath, storePath, ownerPath, httpPath, issueRoute, claimRoute, activateRoute]) {
      expect(fs.existsSync(file)).toBe(true)
    }
  })

  it('exports the transactional service factory and keeps fail-closed adapters explicit', () => {
    const store = read(storePath)
    const adapter = read(adapterPath)
    expect(store).toContain('createPrejoinResourceService')
    expect(store).toContain('FirestorePrejoinResourceStore')
    expect(store).toContain('activateInvitation')
    expect(store).toContain('recoverInvitation')
    expect(adapter).toContain("acceptsPrejoinClaims: false")
    expect(adapter).toContain("key: 'conversation'")
    expect(adapter).toContain("key: 'support-ticket'")
    expect(adapter).toContain("key: 'service-workspace'")
  })

  it('binds issue/claim/activate routes to auth context and never trusts body owner/recipient identity', () => {
    const issue = read(issueRoute)
    const claim = read(claimRoute)
    const activate = read(activateRoute)
    expect(issue).toContain('withCrmAuth')
    expect(issue).toContain('loadPrejoinResourceOwner')
    expect(issue).toContain('ctx.orgId')
    expect(issue).toContain('deliveryToken')
    expect(issue).toContain('projectPrejoinInvitation')
    expect(claim).toContain('loadActorEmailHash')
    expect(claim).toContain('identityVerified: true')
    expect(activate).toContain('invitation.recipientUserId')
    expect(activate).not.toContain('body.recipientUserId')
    expect(activate).toContain('ownerVerifierAuthorized: true')
  })
})
