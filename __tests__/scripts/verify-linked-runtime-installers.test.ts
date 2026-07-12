import { verifyLinkedRuntimeInstallers } from '../../scripts/verify-linked-runtime-installers'

describe('linked runtime installer verifier', () => {
  it('accepts only installers that satisfy the pairing, secret-storage, service, update and lifecycle contract', () => {
    expect(verifyLinkedRuntimeInstallers()).toEqual([])
  })
})
