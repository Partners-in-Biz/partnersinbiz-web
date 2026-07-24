import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSyncArgs, runWorkspaceSync } from '@/scripts/sync-client-workspace'

async function runSync(root: string, args: string[]) {
  const previousPath = process.env.PATH
  const previousFakeRoot = process.env.FAKE_REMOTE_ROOT
  const previousTestBin = process.env.PIB_TEST_BIN_DIR
  process.env.PATH = `${join(root, 'bin')}:${previousPath ?? ''}`
  process.env.FAKE_REMOTE_ROOT = root
  process.env.PIB_TEST_BIN_DIR = join(root, 'bin')
  try {
    const report = await runWorkspaceSync(parseSyncArgs(args))
    return { status: 0, stdout: `${JSON.stringify(report)}\n`, stderr: '' }
  } catch (error) {
    return {
      status: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  } finally {
    process.env.PATH = previousPath
    if (previousFakeRoot === undefined) delete process.env.FAKE_REMOTE_ROOT
    else process.env.FAKE_REMOTE_ROOT = previousFakeRoot
    if (previousTestBin === undefined) delete process.env.PIB_TEST_BIN_DIR
    else process.env.PIB_TEST_BIN_DIR = previousTestBin
  }
}

describe('Workspace sync immutable plan/apply integration', () => {
  jest.setTimeout(30_000)

  it('rejects stale plans, applies only approved paths, verifies checksums, and guards pushes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pib-workspace-sync-'))
    const bin = join(root, 'bin')
    const localRoot = join(root, 'local')
    const stateRoot = join(root, 'state')
    const localWorkspace = join(localRoot, 'partners', 'Test Workspace')
    const remoteWorkspace = join(root, 'remote-cowork', 'partners', 'Test Workspace')
    const remoteAgent = join(root, 'remote-wiki', 'agents', 'test-workspace')
    await Promise.all([
      mkdir(bin, { recursive: true }), mkdir(localWorkspace, { recursive: true }),
      mkdir(join(localRoot, 'Cowork', 'agents', 'test-workspace'), { recursive: true }),
      mkdir(remoteWorkspace, { recursive: true }), mkdir(remoteAgent, { recursive: true }),
    ])

    const sshShim = join(bin, 'ssh')
    await writeFile(sshShim, `#!/usr/bin/env python3
import base64,os,re,subprocess,sys
script=sys.stdin.read()
root=os.environ['FAKE_REMOTE_ROOT']
def remap(value):
  value=value.replace('/var/lib/hermes/Cowork/partners/Test Workspace',os.path.join(root,'remote-cowork','partners','Test Workspace'))
  value=value.replace('/var/lib/hermes/cowork-wiki/agents/test-workspace',os.path.join(root,'remote-wiki','agents','test-workspace'))
  value=value.replace('/var/lib/hermes/Cowork',os.path.join(root,'remote-cowork'))
  value=value.replace('/var/lib/hermes/cowork-wiki/agents',os.path.join(root,'remote-wiki','agents'))
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
  value=value.replace('/var/lib/hermes/Cowork/partners/Test Workspace',os.path.join(root,'remote-cowork','partners','Test Workspace'))
  value=value.replace('/var/lib/hermes/cowork-wiki/agents/test-workspace',os.path.join(root,'remote-wiki','agents','test-workspace'))
  return value
src,dst=clean(src),clean(dst)
marker=os.path.join(root,'fail-rsync-once')
if os.path.exists(marker) and 'z-fail.md' in (src+dst):
  os.unlink(marker)
  sys.stderr.write('intentional second-operation failure\\n')
  sys.exit(23)
os.makedirs(os.path.dirname(dst),exist_ok=True)
shutil.copy2(src,dst)
`)
    await chmod(rsyncShim, 0o755)

    await writeFile(join(remoteWorkspace, 'remote.md'), 'remote-v1\n')
    await writeFile(join(remoteWorkspace, 'ignored.env'), 'SECRET=not-synced\n')
    const manifestPath = join(remoteWorkspace, '.pib-workspace.json')
    const manifest = {
      schemaVersion: 1,
      workspaceId: 'workspace-test-1',
      orgId: 'org-test-1',
      agentDomain: 'test-workspace',
      vpsPath: remoteWorkspace,
      agentDomainPath: remoteAgent,
      sourceOfTruth: 'vps',
    }
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, manifestContent)
    const baseArgs = [
      '--workspace', 'Test Workspace', '--agent-domain', 'test-workspace', '--host', 'fake.example',
      '--local-root', localRoot, '--state-root', stateRoot, '--json',
    ]

    const initialPlan = await runSync(root, baseArgs)
    if (initialPlan.status !== 0) throw new Error(initialPlan.stderr || 'initial plan failed')
    expect(initialPlan.status).toBe(0)
    const first = JSON.parse(initialPlan.stdout) as { planId: string; plan: Array<{ path: string }> }
    expect(first.plan.map((entry) => entry.path)).toContain('workspace/remote.md')
    expect(first.plan.map((entry) => entry.path)).not.toContain('workspace/ignored.env')

    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, orgId: 'org-replaced' }, null, 2)}\n`)
    const replacedManifestApply = await runSync(root, [
      ...baseArgs, '--apply', '--plan', first.planId, '--approve-path', 'workspace/remote.md',
    ])
    expect(replacedManifestApply.status).not.toBe(0)
    expect(replacedManifestApply.stderr).toContain('manifest identity changed')
    expect(existsSync(join(localWorkspace, 'remote.md'))).toBe(false)
    await writeFile(manifestPath, manifestContent)

    await writeFile(join(remoteWorkspace, 'remote.md'), 'remote-v2-after-plan\n')
    const staleApply = await runSync(root, [
      ...baseArgs, '--apply', '--plan', first.planId, '--approve-path', 'workspace/remote.md',
    ])
    expect(staleApply.status).not.toBe(0)
    expect(staleApply.stderr).toContain('plan is stale')
    expect(existsSync(join(localWorkspace, 'remote.md'))).toBe(false)

    const freshPlanResult = await runSync(root, baseArgs)
    expect(freshPlanResult.status).toBe(0)
    const fresh = JSON.parse(freshPlanResult.stdout) as { planId: string }
    const pullApply = await runSync(root, [
      ...baseArgs, '--apply', '--plan', fresh.planId, '--approve-path', 'workspace/remote.md',
    ])
    expect(pullApply.status).toBe(0)
    expect(await readFile(join(localWorkspace, 'remote.md'), 'utf8')).toBe('remote-v2-after-plan\n')
    const pullReport = JSON.parse(pullApply.stdout) as { journalPath: string; operations: Array<{ status: string }> }
    expect(pullReport.operations).toEqual([expect.objectContaining({ status: 'completed' })])
    expect(JSON.parse(await readFile(pullReport.journalPath, 'utf8'))).toMatchObject({ status: 'completed' })

    await writeFile(join(remoteWorkspace, 'remote.md'), 'remote-v3-replacement\n')
    const replacementPlanResult = await runSync(root, baseArgs)
    expect(replacementPlanResult.status).toBe(0)
    const replacementPlan = JSON.parse(replacementPlanResult.stdout) as { planId: string }
    const replacementApply = await runSync(root, [
      ...baseArgs, '--apply', '--plan', replacementPlan.planId, '--approve-path', 'workspace/remote.md',
    ])
    expect(replacementApply.status).toBe(0)
    const replacementReport = JSON.parse(replacementApply.stdout) as {
      operations: Array<{ backupPath?: string; backupHash?: string; verifiedHash?: string }>
    }
    expect(replacementReport.operations[0]).toEqual(expect.objectContaining({ backupHash: expect.any(String), verifiedHash: expect.any(String) }))
    expect(await readFile(replacementReport.operations[0].backupPath!, 'utf8')).toBe('remote-v2-after-plan\n')
    expect(await readFile(join(localWorkspace, 'remote.md'), 'utf8')).toBe('remote-v3-replacement\n')

    await writeFile(join(localWorkspace, 'local.md'), 'approved-local\n')
    const pushPlanResult = await runSync(root, [...baseArgs, '--direction', 'both'])
    expect(pushPlanResult.status).toBe(0)
    const pushPlan = JSON.parse(pushPlanResult.stdout) as { planId: string }
    const blockedPush = await runSync(root, [
      ...baseArgs, '--apply', '--plan', pushPlan.planId, '--approve-path', 'workspace/local.md',
    ])
    expect(blockedPush.status).not.toBe(0)
    expect(blockedPush.stderr).toContain('--allow-push')

    const wrongWorkspacePush = await runSync(root, [
      ...baseArgs, '--apply', '--plan', pushPlan.planId, '--approve-path', 'workspace/local.md',
      '--allow-push', '--confirm-workspace', 'wrong-workspace',
    ])
    expect(wrongWorkspacePush.status).not.toBe(0)
    expect(wrongWorkspacePush.stderr).toContain('manifest workspaceId')

    const approvedPush = await runSync(root, [
      ...baseArgs, '--apply', '--plan', pushPlan.planId, '--approve-path', 'workspace/local.md',
      '--allow-push', '--confirm-workspace', 'workspace-test-1',
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

    await writeFile(join(remoteWorkspace, 'a-first.md'), 'first-operation\n')
    await writeFile(join(remoteWorkspace, 'z-fail.md'), 'second-operation\n')
    const partialPlanResult = await runSync(root, baseArgs)
    expect(partialPlanResult.status).toBe(0)
    const partialPlan = JSON.parse(partialPlanResult.stdout) as { planId: string }
    await writeFile(join(root, 'fail-rsync-once'), 'fail once\n')
    const partialApply = await runSync(root, [
      ...baseArgs, '--apply', '--plan', partialPlan.planId,
      '--approve-path', 'workspace/a-first.md', '--approve-path', 'workspace/z-fail.md',
    ])
    expect(partialApply.status).not.toBe(0)
    expect(partialApply.stderr).toMatch(/rsync failed \(23\)|intentional second-operation failure/)
    expect(await readFile(join(localWorkspace, 'a-first.md'), 'utf8')).toBe('first-operation\n')
    expect(existsSync(join(localWorkspace, 'z-fail.md'))).toBe(false)
    const partialState = JSON.parse(await readFile(join(stateRoot, 'states', stateFiles[0]), 'utf8')) as { baseline: Record<string, string> }
    expect(partialState.baseline['workspace/a-first.md']).toEqual(expect.any(String))
    expect(partialState.baseline['workspace/z-fail.md']).toBeUndefined()

    await writeFile(join(localWorkspace, 'stable.md'), 'same-on-both-sides\n')
    await writeFile(join(remoteWorkspace, 'stable.md'), 'same-on-both-sides\n')
    const resumePlanResult = await runSync(root, baseArgs)
    expect(resumePlanResult.status).toBe(0)
    const resumePlan = JSON.parse(resumePlanResult.stdout) as {
      planId: string
      plan: Array<{ path: string; action: string }>
    }
    expect(resumePlan.plan).toContainEqual(expect.objectContaining({ path: 'workspace/a-first.md', action: 'none' }))
    expect(resumePlan.plan).toContainEqual(expect.objectContaining({ path: 'workspace/z-fail.md', action: 'pull' }))
    const resumeApply = await runSync(root, [
      ...baseArgs, '--apply', '--plan', resumePlan.planId, '--approve-path', 'workspace/z-fail.md',
    ])
    expect(resumeApply.status).toBe(0)
    expect(await readFile(join(localWorkspace, 'z-fail.md'), 'utf8')).toBe('second-operation\n')
    const seededState = JSON.parse(await readFile(join(stateRoot, 'states', stateFiles[0]), 'utf8')) as { baseline: Record<string, string> }
    expect(seededState.baseline['workspace/stable.md']).toEqual(expect.any(String))

    await writeFile(join(localWorkspace, 'stable.md'), 'local-only-change\n')
    const oneSidedPlanResult = await runSync(root, [...baseArgs, '--direction', 'both'])
    expect(oneSidedPlanResult.status).toBe(0)
    const oneSidedPlan = JSON.parse(oneSidedPlanResult.stdout) as {
      plan: Array<{ path: string; action: string; classification: string }>
    }
    expect(oneSidedPlan.plan).toContainEqual(expect.objectContaining({
      path: 'workspace/stable.md', action: 'push', classification: 'push',
    }))

    await symlink(join(remoteWorkspace, 'remote.md'), join(remoteWorkspace, 'linked.md'))
    const unsafePlan = await runSync(root, baseArgs)
    expect(unsafePlan.status).not.toBe(0)
    expect(unsafePlan.stderr).toContain('symlink in sync tree')
  })
})
