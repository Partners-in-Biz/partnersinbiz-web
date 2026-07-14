import { spawnSync } from 'node:child_process'
import {
  buildRemoteWorkspaceProbeScript,
  parseRemoteWorkspaceProbeOutput,
  type WorkspaceFolderObservation,
  type WorkspaceProjectProbeInput,
} from './verification-probes'

export interface PartnersVerificationSshConfig { host: string; user: string }

export interface VerificationSpawnResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

export type VerificationSpawn = (
  command: string,
  args: string[],
  options: { input: string; encoding: 'utf8'; timeout: number; maxBuffer: number },
) => VerificationSpawnResult

const defaultSpawn: VerificationSpawn = (command, args, options) => {
  const result = spawnSync(command, args, options)
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  }
}

export function parsePartnersVerificationSshConfig(
  env: Record<string, string | undefined>,
): PartnersVerificationSshConfig {
  const host = env.PIB_VPS_HOST?.trim() ?? ''
  const user = env.PIB_VPS_USER?.trim() || 'root'
  if (!host) throw new Error('PIB_VPS_HOST is required for the VPS verification probe')
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host)) throw new Error('PIB_VPS_HOST contains unsafe characters')
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(user)) throw new Error('PIB_VPS_USER contains unsafe characters')
  return { host, user }
}

export async function runRemoteWorkspaceFolderProbe(
  input: WorkspaceProjectProbeInput,
  ssh: PartnersVerificationSshConfig,
  spawn: VerificationSpawn = defaultSpawn,
): Promise<WorkspaceFolderObservation> {
  const script = buildRemoteWorkspaceProbeScript(input)
  const result = spawn('ssh', [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=yes',
    `${ssh.user}@${ssh.host}`,
    'python3', '-',
  ], {
    input: script,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) throw new Error('remote workspace folder probe failed')
  return parseRemoteWorkspaceProbeOutput(result.stdout)
}
