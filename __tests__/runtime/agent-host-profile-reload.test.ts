/**
 * @jest-environment node
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ensureHermesProfile = jest.fn()
const disableManagedHermesProfile = jest.fn()
const enableManagedHermesProfile = jest.fn()
const isManagedLaunchdHermesProfile = jest.fn()
const reloadHermesGateway = jest.fn()
const stopHermesGateway = jest.fn()
const waitForAgentHealthy = jest.fn()

jest.mock('@/runtime-installers/runtime/hermes-profile-lifecycle', () => ({
  disableManagedHermesProfile: (...args: unknown[]) => disableManagedHermesProfile(...args),
  enableManagedHermesProfile: (...args: unknown[]) => enableManagedHermesProfile(...args),
  ensureHermesProfile: (...args: unknown[]) => ensureHermesProfile(...args),
  isManagedLaunchdHermesProfile: (...args: unknown[]) => isManagedLaunchdHermesProfile(...args),
  reloadHermesGateway: (...args: unknown[]) => reloadHermesGateway(...args),
  stopHermesGateway: (...args: unknown[]) => stopHermesGateway(...args),
  waitForAgentHealthy: (...args: unknown[]) => waitForAgentHealthy(...args),
}))

import { executeAgentHostJob } from '@/runtime-installers/runtime/agent-host'

describe('agent-host profile reloads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ensureHermesProfile.mockReturnValue({ created: false, port: 8755, apiKeyPresent: true, hermesBin: '/tmp/hermes' })
    disableManagedHermesProfile.mockResolvedValue({ disabled: true })
    enableManagedHermesProfile.mockResolvedValue({ started: true })
    isManagedLaunchdHermesProfile.mockReturnValue(false)
    reloadHermesGateway.mockResolvedValue({ started: true, pid: null, hermesBin: '/tmp/hermes' })
    waitForAgentHealthy.mockResolvedValue(true)
  })

  it('reloads only the updated credential profile after its credential file is atomically written', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-reload-'))
    const env = { ...process.env, PIB_HERMES_HOME: home, HERMES_HOME: home }
    reloadHermesGateway.mockImplementation(async () => {
      expect(fs.readFileSync(path.join(home, 'profiles', 'theo', '.env'), 'utf8'))
        .toContain('PROVIDER_API_KEY=test-credential')
      return { started: true, pid: null, hermesBin: '/tmp/hermes' }
    })

    const result = await executeAgentHostJob({
      jobId: 'credential-reload-1',
      kind: 'sync-credential',
      status: 'claimed',
      agentId: 'theo',
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8756,
      protocolVersion: 3,
      credentialDelivery: {
        bindingId: 'binding-1',
        connectionId: 'member:theo:provider',
        credentialVersion: 1,
        provider: 'provider',
        hermesProvider: 'provider',
        envVar: 'PROVIDER_API_KEY',
        canaryModel: 'model-1',
        credentials: { apiKey: 'test-credential' },
      },
    }, {
      env,
      waitForAgentIdle: async () => true,
      providerCanary: async () => ({ ok: true, modelIds: ['model-1'] }),
    })

    expect(result.ok).toBe(true)
    expect(reloadHermesGateway).toHaveBeenCalledWith({ agentId: 'theo', env })
    expect(stopHermesGateway).not.toHaveBeenCalled()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('disables a managed fleet profile without stopping its healthy siblings on uninstall', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-disable-'))
    const env = { ...process.env, PIB_HERMES_HOME: home, HERMES_HOME: home }
    isManagedLaunchdHermesProfile.mockReturnValue(true)
    waitForAgentHealthy.mockResolvedValue(false)

    const result = await executeAgentHostJob({
      jobId: 'managed-uninstall-1',
      kind: 'uninstall',
      status: 'claimed',
      agentId: 'theo',
      policyVersion: null,
      keepInSync: false,
      runtimeSkills: [],
      pibSkills: [],
      vpsExternalDir: null,
      preferredPort: 8756,
    }, { env, probe: async () => ({ availableAgentIds: [] }) })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(disableManagedHermesProfile).toHaveBeenCalledWith({ agentId: 'theo', env })
    expect(stopHermesGateway).not.toHaveBeenCalled()
    fs.rmSync(home, { recursive: true, force: true })
  })
})
