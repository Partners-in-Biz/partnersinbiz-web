import { verifyLinkedRuntimeInstallers,validatePowerShellStructure } from '../../scripts/verify-linked-runtime-installers'

describe('linked runtime installer verifier', () => {
  it('accepts only installers that satisfy the pairing, secret-storage, service, update and lifecycle contract', () => {
    expect(verifyLinkedRuntimeInstallers()).toEqual([])
  })
  it('fallback parser rejects malformed PowerShell strings and braces',()=>{expect(validatePowerShellStructure("function x { 'oops")).toMatch(/string/);expect(validatePowerShellStructure('function x {')).toMatch(/braces/);expect(validatePowerShellStructure('function x {}')).toBeNull()})
})
