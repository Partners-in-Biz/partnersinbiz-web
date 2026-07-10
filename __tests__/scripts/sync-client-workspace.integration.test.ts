import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const scriptPath = join(repoRoot, 'scripts', 'sync-client-workspace.ts')

function runSync(root: string, args: string[]) {
  return spawnSync('npx', ['--yes', 'tsx', scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, FAKE_REMOTE_ROOT: root },
  })
}

describe('Workspace sync immutable plan/apply integration', () => {
  jest.setTimeout(30_000)

  it('rejects stale plans, applies only approved paths, verifies checksums, and guards pushes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pib-workspace-sync-'))
    const bin = join(root, 'bin')
    const localRoot = join(root, 'local')
    const stateRoot = join(root, 'state')
    const remoteWorkspace = join(root, 'remote-workspace')
    const remoteAgent = join(root, 'remote-agent')
    await Promise.all([
      mkdir(bin, { recursive: true }), mkdir(join(localRoot, 'Test Workspace'), { recursive: true }),
      mkdir(join(localRoot, 'Cowork', 'agents', 'test-workspace'), { recursive: true }),
      mkdir(remoteWorkspace, { recursive: true }), mkdir(remoteAgent, { recursive: true }),
    ])

    const sshShim = join(bin, 'ssh')
    await writeFile(sshShim, `#!/usr/bin/env python3
import base64,os,re,subprocess,sys
script=sys.stdin.read()
root=os.environ['FAKE_REMOTE_ROOT']
def remap(value):
  value=value.replace('/var/lib/hermes/Cowork/Test Workspace',os.path.join(root,'remote-workspace'))
  value=value.replace('/var/lib/hermes/cowork-wiki/agents/test-workspace',os.path.join(root,'remote-agent'))
  return value.replace('/var/lib/hermes/.pib-sync-backups/test-workspace',os.path.join(root,'remote-backups'))
script=remap(script)
def remap_payload(match):
  decoded=base64.b64decode(match.group(1)).decode('utf-8')
  encoded=base64.b64encode(remap(decoded).encode('utf-8')).decode('ascii')
  return 'base64.b64decode("'+encoded+'")'
script=re.sub(r'base64\\.b64decode\\("([A-Za-z0-9+/=]+)"\\)',remap_payload,script)
result=subprocess.run(['/usr/bin/python3','-'],input=script,text=True,capture_output=True)
sys.stdout.write(result.stdout); sys.stderr.write(result.stderr); sys.exit(result.returncode)
`)
    await chmod(sshShim, 0o755)

    const rsyncShim = join(bin, 'rsync')
    await writeFile(rsyncShim, `#!/usr/bin/env python3
import os,shutil,sys
root=os.environ['FAKE_REMOTE_ROOT']
src,dst=sys.argv[-2:]
def clean(value):
  if ':' in value: value=value.split(':',1)[1]
  if len(value)>1 and value[0]==value[-1]=="'": value=value[1:-1]
  value=value.replace('/var/lib/hermes/Cowork/Test Workspace',os.path.join(root,'remote-workspace'))
  value=value.replace('/var/lib/hermes/cowork-wiki/agents/test-workspace',os.path.join(root,'remote-agent'))
  return value
src,dst=clean(src),clean(dst)
os.makedirs(os.path.dirname(dst),exist_ok=True)
shutil.copy2(src,dst)
`)
    await chmod(rsyncShim, 0o755)

    await writeFile(join(remoteWorkspace, 'remote.md'), 'remote-v1\n')
    await writeFile(join(remoteWorkspace, 'ignored.env'), 'SECRET=not-synced\n')
    const baseArgs = [
      '--workspace', 'Test Workspace', '--agent-domain', 'test-workspace', '--host', 'fake.example',
      '--local-root', localRoot, '--state-root', stateRoot, '--json',
    ]

    const initialPlan = runSync(root, baseArgs)
    if (initialPlan.status !== 0) throw new Error(initialPlan.stderr || initialPlan.error?.message)
    expect(initialPlan.status).toBe(0)
    const first = JSON.parse(initialPlan.stdout) as { planId: string; plan: Array<{ path: string }> }
    expect(first.plan.map((entry) => entry.path)).toContain('workspace/remote.md')
    expect(first.plan.map((entry) => entry.path)).not.toContain('workspace/ignored.env')

    await writeFile(join(remoteWorkspace, 'remote.md'), 'remote-v2-after-plan\n')
    const staleApply = runSync(root, [
      ...baseArgs, '--apply', '--plan', first.planId, '--approve-path', 'workspace/remote.md',
    ])
    expect(staleApply.status).not.toBe(0)
    expect(staleApply.stderr).toContain('plan is stale')
    expect(existsSync(join(localRoot, 'Test Workspace', 'remote.md'))).toBe(false)

    const freshPlanResult = runSync(root, baseArgs)
    expect(freshPlanResult.status).toBe(0)
    const fresh = JSON.parse(freshPlanResult.stdout) as { planId: string }
    const pullApply = runSync(root, [
      ...baseArgs, '--apply', '--plan', fresh.planId, '--approve-path', 'workspace/remote.md',
    ])
    expect(pullApply.status).toBe(0)
    expect(await readFile(join(localRoot, 'Test Workspace', 'remote.md'), 'utf8')).toBe('remote-v2-after-plan\n')
    const pullReport = JSON.parse(pullApply.stdout) as { journalPath: string; operations: Array<{ status: string }> }
    expect(pullReport.operations).toEqual([expect.objectContaining({ status: 'completed' })])
    expect(JSON.parse(await readFile(pullReport.journalPath, 'utf8'))).toMatchObject({ status: 'completed' })

    await writeFile(join(remoteWorkspace, 'remote.md'), 'remote-v3-replacement\n')
    const replacementPlanResult = runSync(root, baseArgs)
    expect(replacementPlanResult.status).toBe(0)
    const replacementPlan = JSON.parse(replacementPlanResult.stdout) as { planId: string }
    const replacementApply = runSync(root, [
      ...baseArgs, '--apply', '--plan', replacementPlan.planId, '--approve-path', 'workspace/remote.md',
    ])
    expect(replacementApply.status).toBe(0)
    const replacementReport = JSON.parse(replacementApply.stdout) as {
      operations: Array<{ backupPath?: string; backupHash?: string; verifiedHash?: string }>
    }
    expect(replacementReport.operations[0]).toEqual(expect.objectContaining({ backupHash: expect.any(String), verifiedHash: expect.any(String) }))
    expect(await readFile(replacementReport.operations[0].backupPath!, 'utf8')).toBe('remote-v2-after-plan\n')
    expect(await readFile(join(localRoot, 'Test Workspace', 'remote.md'), 'utf8')).toBe('remote-v3-replacement\n')

    await writeFile(join(localRoot, 'Test Workspace', 'local.md'), 'approved-local\n')
    const pushPlanResult = runSync(root, [...baseArgs, '--direction', 'both'])
    expect(pushPlanResult.status).toBe(0)
    const pushPlan = JSON.parse(pushPlanResult.stdout) as { planId: string }
    const blockedPush = runSync(root, [
      ...baseArgs, '--apply', '--plan', pushPlan.planId, '--approve-path', 'workspace/local.md',
    ])
    expect(blockedPush.status).not.toBe(0)
    expect(blockedPush.stderr).toContain('--allow-push')

    const approvedPush = runSync(root, [
      ...baseArgs, '--apply', '--plan', pushPlan.planId, '--approve-path', 'workspace/local.md', '--allow-push',
    ])
    expect(approvedPush.status).toBe(0)
    expect(await readFile(join(remoteWorkspace, 'local.md'), 'utf8')).toBe('approved-local\n')
    const stateFiles = await readdir(join(stateRoot, 'states'))
    expect(stateFiles).toHaveLength(1)
    const finalState = JSON.parse(await readFile(join(stateRoot, 'states', stateFiles[0]), 'utf8')) as { baseline: Record<string, string> }
    expect(finalState.baseline).toEqual(expect.objectContaining({
      'workspace/remote.md': expect.any(String),
      'workspace/local.md': expect.any(String),
    }))

    await symlink(join(remoteWorkspace, 'remote.md'), join(remoteWorkspace, 'linked.md'))
    const unsafePlan = runSync(root, baseArgs)
    expect(unsafePlan.status).not.toBe(0)
    expect(unsafePlan.stderr).toContain('symlink in sync tree')
  })
})
