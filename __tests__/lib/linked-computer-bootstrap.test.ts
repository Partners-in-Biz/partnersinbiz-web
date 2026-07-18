import {
  linkedComputerBootstrapCommand,
  linkedComputerBootstrapReady,
  linkedComputerSetupDownload,
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

  it('creates a downloadable nonsecret setup file for each platform', () => {
    const mac = linkedComputerSetupDownload({ platform: 'macos', challengeId: 'challenge_123', profiles: ['pip'], providers: ['nous'] })
    expect(mac.filename).toBe('partners-in-biz-setup-macos.sh')
    expect(mac.content).toContain('#!/bin/bash')
    expect(mac.content).toContain("--challenge 'challenge_123'")
    const windows = linkedComputerSetupDownload({ platform: 'windows', challengeId: 'challenge_123', profiles: ['pip'], providers: ['nous'] })
    expect(windows.filename).toBe('partners-in-biz-setup.ps1')
    expect(windows.content).toContain("-ChallengeId 'challenge_123'")
    expect(`${mac.content}${windows.content}`).not.toMatch(/api[_-]?key|pairing code|credential/i)
  })
})
