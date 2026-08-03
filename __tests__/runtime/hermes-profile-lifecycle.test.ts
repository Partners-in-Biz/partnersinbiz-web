/**
 * @jest-environment node
 */

const mockSpawnSync = jest.fn()
const mockExistsSync = jest.fn()
const mockWriteFileSync = jest.fn()
const mockReadFileSync = jest.fn()
const mockRenameSync = jest.fn()

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}))

jest.mock('node:fs', () => ({
  __esModule: true,
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: jest.fn(),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    renameSync: (...args: unknown[]) => mockRenameSync(...args),
    rmSync: jest.fn(),
  },
}))

import { disableManagedHermesProfile, reloadHermesGateway, startHermesGateway, stopHermesGateway } from '@/runtime-installers/runtime/hermes-profile-lifecycle'

describe('macOS Hermes launchd fleet lifecycle', () => {
  const env = {
    PIB_RUNTIME_PLATFORM: 'darwin',
    PIB_HERMES_FLEET_LAUNCHD_PLIST: '/tmp/ai.hermes.local-runtime.plist',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockExistsSync.mockImplementation((file: unknown) =>
      file === '/tmp/ai.hermes.local-runtime.plist')
    mockReadFileSync.mockReturnValue('')
  })

  it('never boots out the supervising launch agent to stop one managed profile', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes

    expect(stopHermesGateway({ agentId: 'theo', env })).toEqual({
      stopped: false,
      hermesBin: null,
      error: expect.stringMatching(/cannot stop one profile directly/i),
    })
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('bootout'))).toBe(false)
  })

  it('leaves an already-running fleet alone', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes
      .mockReturnValueOnce({ status: 0, stdout: 'state = running\n', stderr: '' }) // launchctl print

    expect(startHermesGateway({ agentId: 'theo', env })).toEqual({
      started: true,
      pid: null,
      hermesBin: null,
    })
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('kickstart'))).toBe(false)
  })

  it('uses non-destructive kickstart only when the loaded fleet is inactive', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes
      .mockReturnValueOnce({ status: 0, stdout: 'state = spawn scheduled\n', stderr: '' }) // launchctl print
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // kickstart

    expect(startHermesGateway({ agentId: 'theo', env })).toEqual({
      started: true,
      pid: null,
      hermesBin: null,
    })
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'launchctl',
      ['kickstart', expect.stringContaining('ai.hermes.local-runtime')],
      expect.any(Object),
    )
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('-k'))).toBe(false)
  })

  it('asks the fleet to reload just one profile without booting out the supervisor', async () => {
    let request: { requestId: string } | null = null
    mockSpawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes
      .mockReturnValueOnce({ status: 0, stdout: 'state = running\n', stderr: '' }) // launchctl print
    mockWriteFileSync.mockImplementation((_file: unknown, contents: unknown) => {
      request = JSON.parse(String(contents)) as { requestId: string }
    })
    mockReadFileSync.mockImplementation((file: unknown) => {
      if (String(file).includes('/acks/')) {
        return JSON.stringify({ action: 'restart', requestId: request?.requestId, status: 'restarted' })
      }
      return ''
    })

    await expect(reloadHermesGateway({ agentId: 'theo', env })).resolves.toEqual({
      started: true,
      pid: null,
      hermesBin: null,
    })
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('/requests/theo.json.'),
      expect.stringContaining('"agentId":"theo"'),
      expect.objectContaining({ mode: 0o600 }),
    )
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('bootout'))).toBe(false)
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('-k'))).toBe(false)
  })

  it('surfaces deferred busy restarts without falling back to a hard profile stop', async () => {
    let request: { requestId: string } | null = null
    mockSpawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes
      .mockReturnValueOnce({ status: 0, stdout: 'state = running\n', stderr: '' }) // launchctl print
    mockWriteFileSync.mockImplementation((_file: unknown, contents: unknown) => {
      request = JSON.parse(String(contents)) as { requestId: string }
    })
    mockReadFileSync.mockImplementation((file: unknown) => {
      if (String(file).includes('/acks/')) {
        return JSON.stringify({
          action: 'restart',
          requestId: request?.requestId,
          status: 'deferred',
          error: 'profile has active /v1/runs; restart deferred',
        })
      }
      return ''
    })

    await expect(reloadHermesGateway({ agentId: 'docs', env })).resolves.toEqual({
      started: false,
      pid: null,
      hermesBin: null,
      error: 'profile has active /v1/runs; restart deferred',
    })
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('gateway'))).toBe(false)
  })

  it('uses the existing target-only supervisor recovery while an older fleet script is still running', async () => {
    const fallbackEnv = { ...env, PIB_HERMES_BIN: '/tmp/hermes' }
    mockExistsSync.mockImplementation((file: unknown) =>
      file === '/tmp/ai.hermes.local-runtime.plist' || file === '/tmp/hermes')
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'state = running\n', stderr: '' }) // launchctl print
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // Hermes profile stop

    await expect(reloadHermesGateway({ agentId: 'theo', env: fallbackEnv, timeoutMs: 0 })).resolves.toEqual({
      started: true,
      pid: null,
      hermesBin: '/tmp/hermes',
    })
    expect(mockSpawnSync).toHaveBeenCalledWith(
      '/tmp/hermes',
      ['-p', 'theo', 'gateway', 'stop'],
      expect.any(Object),
    )
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('bootout'))).toBe(false)
  })

  it('disables only the requested profile through an acknowledged fleet control request', async () => {
    let request: { requestId: string; action: string } | null = null
    mockSpawnSync
      .mockReturnValue({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes
      .mockReturnValueOnce({ status: 0, stdout: 'state = running\n', stderr: '' }) // launchctl print
    mockWriteFileSync.mockImplementation((_file: unknown, contents: unknown) => {
      request = JSON.parse(String(contents)) as { requestId: string; action: string }
    })
    mockReadFileSync.mockImplementation((file: unknown) => {
      if (String(file).includes('/acks/')) {
        return JSON.stringify({ action: request?.action, requestId: request?.requestId, status: 'disabled' })
      }
      return ''
    })

    await expect(disableManagedHermesProfile({ agentId: 'theo', env })).resolves.toEqual({ disabled: true })
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('/requests/theo.json.'),
      expect.stringContaining('"action":"disable"'),
      expect.objectContaining({ mode: 0o600 }),
    )
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('bootout'))).toBe(false)
  })

  it('keeps custom macOS profiles on the direct per-profile stop path', () => {
    const customEnv = { ...env, PIB_HERMES_BIN: '/tmp/hermes' }
    mockExistsSync.mockImplementation((file: unknown) =>
      file === '/tmp/ai.hermes.local-runtime.plist' || file === '/tmp/hermes')
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' })

    expect(stopHermesGateway({ agentId: 'member-research', env: customEnv })).toEqual({
      stopped: true,
      hermesBin: '/tmp/hermes',
    })
    expect(mockSpawnSync).toHaveBeenCalledWith(
      '/tmp/hermes',
      ['-p', 'member-research', 'gateway', 'stop'],
      expect.any(Object),
    )
    expect(mockSpawnSync.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('bootout'))).toBe(false)
  })
})
