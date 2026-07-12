import { verifyLinkedRuntimeInstallers,validatePowerShellStructure } from '../../scripts/verify-linked-runtime-installers'

describe('linked runtime installer verifier', () => {
  it('accepts only installers that satisfy the pairing, secret-storage, service, update and lifecycle contract', () => {
    expect(verifyLinkedRuntimeInstallers()).toEqual([])
  })
  it('fallback parser handles comments, escaped/doubled quotes, here strings and all delimiters',()=>{expect(validatePowerShellStructure("function x { 'oops")).toMatch(/string/);expect(validatePowerShellStructure('function x {')).toMatch(/brace/);expect(validatePowerShellStructure('function x { # } ignored\n $x=@\"\n{[(quoted)]}\n\"@; Write-Host \"a`\"b\"; Write-Host \'it\'\'s\' }')).toBeNull();expect(validatePowerShellStructure('function x { [abc) }')).toMatch(/delimiter/);expect(validatePowerShellStructure("@'\nnever closed")).toMatch(/here-string/)})
})
