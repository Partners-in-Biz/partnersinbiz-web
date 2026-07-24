import {
  parsePartnersVerificationSshConfig,
  runRemoteWorkspaceFolderProbe,
  type VerificationSpawn,
} from '@/lib/project-locations/verification-ssh'

describe('Partners verification SSH probe', () => {
  it('requires an explicit safe host and defaults only the SSH user', () => {
    expect(() => parsePartnersVerificationSshConfig({})).toThrow('PIB_VPS_HOST is required')
    expect(() => parsePartnersVerificationSshConfig({ PIB_VPS_HOST: '-oProxyCommand=bad' })).toThrow('unsafe')
    expect(() => parsePartnersVerificationSshConfig({ PIB_VPS_HOST: 'host', PIB_VPS_USER: 'root;bad' })).toThrow('unsafe')
    expect(parsePartnersVerificationSshConfig({ PIB_VPS_HOST: '65.108.146.144' })).toEqual({
      host: '65.108.146.144', user: 'root',
    })
  })

  it('uses strict non-interactive SSH with a read-only Python stdin probe', async () => {
    const calls: Array<Record<string, unknown>> = []
    const spawn: VerificationSpawn = (command, args, options) => {
      calls.push({ command, args, input: options.input })
      return {
        status: 0,
        stdout: '{"workspaceRootMatches":true,"projectFolderIds":["project-a"],"nonEmptyProjectFolderCount":0}\n',
        stderr: '',
      }
    }
    const result = await runRemoteWorkspaceFolderProbe({
      workspaceRoot: '/var/lib/hermes/Cowork/partners/Partners in Biz',
      projects: [{ projectId: 'project-a', relativePath: 'projects/project-a' }],
    }, { host: '65.108.146.144', user: 'root' }, spawn)
    expect(result.projectFolderIds).toEqual(['project-a'])
    expect(calls[0]).toEqual(expect.objectContaining({ command: 'ssh' }))
    expect(calls[0].args).toEqual(expect.arrayContaining([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=yes',
      'root@65.108.146.144', 'python3', '-',
    ]))
    expect(String(calls[0].input)).toContain('pathlib.Path')
  })

  it('does not leak SSH stderr when the remote probe fails', async () => {
    const spawn: VerificationSpawn = () => ({ status: 255, stdout: '', stderr: 'secret host detail' })
    await expect(runRemoteWorkspaceFolderProbe({
      workspaceRoot: '/var/lib/hermes/Cowork/partners/Partners in Biz', projects: [],
    }, { host: '65.108.146.144', user: 'root' }, spawn)).rejects.toThrow('remote workspace folder probe failed')
    await expect(runRemoteWorkspaceFolderProbe({
      workspaceRoot: '/var/lib/hermes/Cowork/partners/Partners in Biz', projects: [],
    }, { host: '65.108.146.144', user: 'root' }, spawn)).rejects.not.toThrow('secret')
  })
})
