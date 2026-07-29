/**
 * @jest-environment node
 */

const mockSpawnSync = jest.fn()
const mockExistsSync = jest.fn()

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}))

jest.mock('node:fs', () => ({
  __esModule: true,
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    rmSync: jest.fn(),
  },
}))

import { startHermesGateway, stopHermesGateway } from '@/runtime-installers/runtime/hermes-profile-lifecycle'

describe('macOS Hermes launchd fleet lifecycle', () => {
  const env = {
    PIB_RUNTIME_PLATFORM: 'darwin',
    PIB_HERMES_FLEET_LAUNCHD_PLIST: '/tmp/ai.hermes.local-runtime.plist',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockExistsSync.mockImplementation((file: unknown) =>
      file === '/tmp/ai.hermes.local-runtime.plist')
  })

  it('boots out the supervising launch agent instead of relying on profile pid files', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // launchctl print
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // bootout

    expect(stopHermesGateway({ agentId: 'theo', env })).toEqual({
      stopped: true,
      hermesBin: null,
    })
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'launchctl',
      expect.arrayContaining(['bootout', expect.stringContaining('gui/'), '/tmp/ai.hermes.local-runtime.plist']),
      expect.any(Object),
    )
  })

  it('bootstraps and kickstarts the fleet after credentials are written', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // which hermes
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' }) // not loaded
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // bootstrap
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // kickstart

    expect(startHermesGateway({ agentId: 'theo', env })).toEqual({
      started: true,
      pid: null,
      hermesBin: null,
    })
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'launchctl',
      expect.arrayContaining(['bootstrap', expect.stringContaining('gui/'), '/tmp/ai.hermes.local-runtime.plist']),
      expect.any(Object),
    )
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'launchctl',
      expect.arrayContaining(['kickstart', '-k', expect.stringContaining('ai.hermes.local-runtime')]),
      expect.any(Object),
    )
  })
})
