import {
  linkedComputerBootstrapCommand,
  linkedComputerBootstrapReady,
  sanitizeHermesProfiles,
  sanitizeHermesProviders,
} from '@/lib/linked-computers/bootstrap'

describe('linked computer bootstrap handoff', () => {
  it('builds a nonsecret macOS handoff with selected profiles and providers', () => {
    const command = linkedComputerBootstrapCommand({
      platform: 'macos', challengeId: 'challenge_123', profiles: ['pip', 'sales'], providers: ['openai', 'anthropic'],
    })
    expect(command).toBe("curl -fsSL https://partnersinbiz.online/runtime/bootstrap/macos.sh | bash -s -- --challenge 'challenge_123' --profiles 'pip,sales' --providers 'openai,anthropic'")
    expect(command).not.toMatch(/api[_-]?key|secret|credential/i)
  })

  it('builds an Administrator PowerShell handoff for native Windows', () => {
    expect(linkedComputerBootstrapCommand({
      platform: 'windows', challengeId: 'challenge_123', profiles: ['support'], providers: ['nous'],
    })).toBe("& ([scriptblock]::Create((irm https://partnersinbiz.online/runtime/bootstrap/windows.ps1))) -ChallengeId 'challenge_123' -Profiles 'support' -Providers 'nous'")
  })

  it('rejects injection-shaped identifiers and bounds all selections', () => {
    expect(() => linkedComputerBootstrapCommand({ platform: 'linux', challengeId: '../bad', profiles: [], providers: [] })).toThrow('invalid challenge')
    expect(sanitizeHermesProfiles(['Sales', 'bad value', 'pip', 'pip'])).toEqual(['sales', 'pip'])
    expect(sanitizeHermesProviders(['OPENAI', 'unknown', 'openai'])).toEqual(['openai'])
  })

  it('activates guided linking only for explicitly published platform bundles', () => {
    expect(linkedComputerBootstrapReady('macos', 'macos,linux')).toBe(true)
    expect(linkedComputerBootstrapReady('linux', 'macos,linux')).toBe(true)
    expect(linkedComputerBootstrapReady('windows', 'macos,linux')).toBe(false)
    expect(linkedComputerBootstrapReady('macos', '')).toBe(false)
  })
})
