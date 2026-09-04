/**
 * @jest-environment node
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { DeviceApiClient } from '../../runtime-installers/runtime/client'
import { linkedRuntimeHeartbeatBody } from '../../runtime-installers/runtime/cli'
import {
  fetchRuntimeConfig,
  HERMES_UPDATE_TIMEOUT_MS,
  hermesVersionBelowMin,
  maybeUpdateHermes,
  probeHermesVersion,
  readHermesContract,
  scheduleHermesUpdateAfterHeartbeat,
  type HermesSpawn,
  type RuntimeConfig,
} from '../../runtime-installers/runtime/hermes-update'

const PINNED: RuntimeConfig = {
  channel: 'internal',
  hermes: { targetVersion: '0.21.0', minVersion: '0.20.6', targetTag: 'v2026.8.31' },
  runtimeMinVersion: '1.2.0',
}

function tmpState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-hermes-update-'))
  return path.join(dir, 'hermes-update-state.json')
}

function versionStdout(version: string) {
  return `Hermes Agent v${version} (2026.8.31)\n`
}

function spawnFor(version: { current: string; afterUpdate?: string }): { spawn: jest.MockedFunction<HermesSpawn>; calls: Array<{ command: string; args: string[]; options?: { timeout?: number } }> } {
  const calls: Array<{ command: string; args: string[]; options?: { timeout?: number } }> = []
  const spawn = jest.fn<HermesSpawn>((command, args, options) => {
    calls.push({ command, args, options })
    if (args.includes('--version')) {
      return { status: 0, stdout: versionStdout(version.current), stderr: '' }
    }
    if (args.includes('--branch')) {
      if (version.afterUpdate) version.current = version.afterUpdate
      return { status: 0, stdout: 'updated\n', stderr: '' }
    }
    return { status: 1, stdout: '', stderr: `unexpected ${command} ${args.join(' ')}` }
  })
  return { spawn, calls }
}

describe('linked runtime hermes update', () => {
  it('reads the checked-in contract pin and installer argv', () => {
    const contract = readHermesContract()
    expect(contract.versionCommand.argv).toEqual(['hermes', '--version'])
    expect(contract.updateCommand.argv).toEqual(['bash', '-s', '--', '--branch', '{tag}', '--non-interactive'])
    expect(contract.updateCommand.updateStrategy).toBe('installer')
    expect(contract.updatePausesGateways).toBe(false)
    expect(contract.updateCommand.argv.join(' ')).not.toMatch(/--ref/)
  })

  it('skips when up to date', async () => {
    const { spawn, calls } = spawnFor({ current: '0.21.0' })
    const stopGateways = jest.fn()
    await expect(maybeUpdateHermes({
      config: PINNED,
      env: {},
      isIdle: async () => true,
      log: () => undefined,
      spawn,
      statePath: tmpState(),
      stopGateways,
    })).resolves.toBe('skipped')
    expect(calls.some((call) => call.args.includes('--branch'))).toBe(false)
    expect(stopGateways).not.toHaveBeenCalled()
  })

  it('skips when busy', async () => {
    const { spawn, calls } = spawnFor({ current: '0.20.6' })
    const stopGateways = jest.fn()
    await expect(maybeUpdateHermes({
      config: PINNED,
      env: {},
      isIdle: async () => false,
      log: () => undefined,
      spawn,
      statePath: tmpState(),
      stopGateways,
    })).resolves.toBe('skipped')
    expect(calls.some((call) => call.args.includes('--branch'))).toBe(false)
    expect(stopGateways).not.toHaveBeenCalled()
  })

  it('runs the contract update command with the pinned tag', async () => {
    const { spawn, calls } = spawnFor({ current: '0.20.6', afterUpdate: '0.21.0' })
    const stopGateways = jest.fn()
    const startGateways = jest.fn()
    const reloadGateways = jest.fn()
    const waitHealthy = jest.fn(async () => true)
    await expect(maybeUpdateHermes({
      config: PINNED,
      env: { HERMES_HOME: '/tmp/hermes-home' },
      isIdle: async () => true,
      log: () => undefined,
      spawn,
      statePath: tmpState(),
      stopGateways,
      startGateways,
      reloadGateways,
      waitHealthy,
    })).resolves.toBe('updated')
    const update = calls.find((call) => call.args.includes('--branch'))
    expect(update).toEqual(expect.objectContaining({
      command: 'bash',
      args: ['-s', '--', '--branch', 'v2026.8.31', '--non-interactive'],
    }))
    expect(update?.args).not.toContain('--ref')
    expect(update?.options?.timeout).toBe(HERMES_UPDATE_TIMEOUT_MS)
    expect(stopGateways).toHaveBeenCalled()
    expect(startGateways).toHaveBeenCalled()
    expect(reloadGateways).toHaveBeenCalled()
    expect(waitHealthy).toHaveBeenCalled()
  })

  it('reports failed when version unchanged after update', async () => {
    const { spawn } = spawnFor({ current: '0.20.6' })
    await expect(maybeUpdateHermes({
      config: PINNED,
      env: {},
      isIdle: async () => true,
      log: () => undefined,
      spawn,
      statePath: tmpState(),
      stopGateways: () => undefined,
      startGateways: () => undefined,
      reloadGateways: () => undefined,
      waitHealthy: async () => true,
    })).resolves.toBe('failed')
  })

  it('does not retry within 6h', async () => {
    const statePath = tmpState()
    let now = Date.parse('2026-09-03T10:00:00.000Z')
    const { spawn, calls } = spawnFor({ current: '0.20.6' })
    const input = {
      config: PINNED,
      env: {},
      isIdle: async () => true,
      log: () => undefined,
      spawn,
      statePath,
      now: () => now,
      stopGateways: () => undefined,
      startGateways: () => undefined,
      reloadGateways: () => undefined,
      waitHealthy: async () => true,
    }
    await expect(maybeUpdateHermes(input)).resolves.toBe('failed')
    const updateCallsAfterFirst = calls.filter((call) => call.args.includes('--branch')).length
    expect(updateCallsAfterFirst).toBe(1)
    now += 60 * 60 * 1000
    await expect(maybeUpdateHermes(input)).resolves.toBe('skipped')
    expect(calls.filter((call) => call.args.includes('--branch')).length).toBe(updateCallsAfterFirst)
  })

  it('probes Hermes Agent vX.Y.Z from the contract version command', () => {
    const spawn: HermesSpawn = (_command, args) => {
      expect(args).toEqual(['--version'])
      return { status: 0, stdout: versionStdout('0.21.0'), stderr: '' }
    }
    expect(probeHermesVersion({ PIB_HERMES_BIN: '' }, spawn)).toEqual({
      version: '0.21.0',
      raw: versionStdout('0.21.0').trim(),
    })
  })

  it('GET runtime-config through the signed device client', async () => {
    const keys = generateKeyPairSync('ed25519')
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        channel: 'internal',
        hermes: PINNED.hermes,
        runtimeMinVersion: '1.2.0',
        serverTime: '2026-09-03T10:00:00.000Z',
      },
    }), { status: 200 })) as typeof fetch
    const client = new DeviceApiClient('https://partnersinbiz.online', {
      deviceId: 'device-a',
      credential: 'cred',
      credentialVersion: 1,
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }, fetcher)
    await expect(fetchRuntimeConfig(client)).resolves.toEqual({
      channel: 'internal',
      hermes: PINNED.hermes,
      runtimeMinVersion: '1.2.0',
      serverTime: '2026-09-03T10:00:00.000Z',
    })
    expect(String(fetcher.mock.calls[0][0])).toBe('https://partnersinbiz.online/api/v1/linked-computers/device-a/runtime-config')
    expect((fetcher.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })

  it('treats a probed Hermes version below the channel min as too old', () => {
    expect(hermesVersionBelowMin('0.20.0', '0.20.6')).toBe(true)
    expect(hermesVersionBelowMin('0.20.6', '0.20.6')).toBe(false)
    expect(hermesVersionBelowMin('0.21.0', '0.20.6')).toBe(false)
    expect(hermesVersionBelowMin(null, '0.20.6')).toBe(false)
  })

  it('pauses run claims when the probed Hermes version is below minVersion', async () => {
    const keys = generateKeyPairSync('ed25519')
    const fetcher = jest.fn(async (url: string) => {
      if (String(url).includes('/runtime-config')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            channel: 'internal',
            hermes: PINNED.hermes,
            runtimeMinVersion: '1.2.0',
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }) as typeof fetch
    const client = new DeviceApiClient('https://partnersinbiz.online', {
      deviceId: 'device-a',
      credential: 'cred',
      credentialVersion: 1,
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }, fetcher)
    const setAcceptingClaims = jest.fn()
    await scheduleHermesUpdateAfterHeartbeat({
      client,
      isIdle: async () => false,
      probedVersion: '0.20.0',
      setAcceptingClaims,
      log: () => undefined,
    })
    expect(setAcceptingClaims).toHaveBeenCalledWith(false)
  })

  it('keeps heartbeat health ok when routes are healthy after a failed Hermes update', () => {
    expect(linkedRuntimeHeartbeatBody('darwin', {
      availableAgentIds: ['pip'],
      healthReason: 'hermes_update_failed',
    })).toEqual(expect.objectContaining({
      health: 'ok',
      healthReason: 'hermes_update_failed',
      capabilities: expect.arrayContaining(['workspace.execute']),
    }))
  })
})
