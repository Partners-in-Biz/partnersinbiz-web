import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const read = (file: string) => fs.readFileSync(file, 'utf8')

describe('Linux VPS linked runtime package', () => {
  it('builds standalone x64 and arm64 runtime and release-manager archives', () => {
    const build = read('runtime-installers/build-runtime.sh')
    expect(build).toMatch(/linux-x64 linux-arm64/)
    expect(build).toMatch(/bun-linux-x64/)
    expect(build).toMatch(/bun-linux-arm64/)
    expect(build).toMatch(/partnersinbiz-runtime-linux-\$?\{?arch/)
  })

  it('is enforced by the repository installer verifier', () => {
    const verifier = read('scripts/verify-linked-runtime-installers.ts')
    expect(verifier).toMatch(/runtime-installers\/linux\/install\.sh/)
    expect(verifier).toMatch(/Linux systemd service/)
    expect(verifier).toMatch(/Linux systemd-creds host encryption/)
    expect(verifier).toMatch(/Linux descriptor-relative rename/)
    expect(verifier).toMatch(/'workspace-sync\.ts','sync-model\.ts'/)
    expect(verifier).toMatch(/verifyLinuxRuntimeArtifact/)
  })

  it('runs as a hardened root system service with native sync protocol v1', () => {
    const unit = read('runtime-installers/linux/pib-runtime.service')
    expect(unit).toMatch(/User=root/)
    expect(unit).toMatch(/ExecStart=\/opt\/partnersinbiz\/current\/pib-runtime supervise/)
    expect(unit).toMatch(/PIB_RUNTIME_STATE_DIR=\/var\/lib\/partnersinbiz/)
    expect(unit).toMatch(/PIB_CREDENTIAL_HELPER=\/opt\/partnersinbiz\/current\/pib-credential-helper/)
    expect(unit).toMatch(/PIB_FILE_HELPER=\/opt\/partnersinbiz\/current\/pib-file-helper/)
    expect(unit).toMatch(/PIB_API_BASE=https:\/\/partnersinbiz\.online/)
    expect(unit).toMatch(/PIB_SYNC_PROTOCOL_VERSION=1/)
    expect(unit).toMatch(/NoNewPrivileges=true/)
    expect(unit).toMatch(/UMask=0077/)
  })

  it('encrypts identity at rest with the systemd host key and never accepts arbitrary names', () => {
    const helper = read('runtime-installers/linux/pib-credential-helper')
    expect(helper).toMatch(/systemd-creds/)
    expect(helper).toMatch(/encrypt[\s\S]*--with-key=host/)
    expect(helper).toMatch(/decrypt[\s\S]*--name=/)
    expect(helper).toMatch(/\^\[A-Za-z0-9\]/)
    expect(helper).not.toMatch(/(?:cat|tee)\s+[^\n]*(?:identity|plaintext|\.json)/i)
  })

  it('uses descriptor-relative rename and rejects path traversal', () => {
    const helper = path.resolve('runtime-installers/linux/pib-file-helper')
    const source = read(helper)
    expect(source).toMatch(/renameat2/)
    expect(source).toMatch(/RENAME_NOREPLACE/)
    expect(source).toMatch(/os\.mkdir\([^\n]*dir_fd=0/)
    expect(source).toMatch(/os\.unlink\([^\n]*dir_fd=0/)
    expect(source).toMatch(/os\.rmdir\([^\n]*dir_fd=0/)
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-linux-file-helper-'))
    const parent = path.join(temp, 'project')
    fs.mkdirSync(parent)
    fs.writeFileSync(path.join(parent, 'from'), 'payload')
    fs.writeFileSync(path.join(parent, 'remove-me'), 'payload')
    const fd = fs.openSync(parent, fs.constants.O_RDONLY)
    try {
      const renamed = spawnSync(helper, ['rename', 'from', 'to'], {
        stdio: [fd, 'pipe', 'pipe'],
        encoding: 'utf8',
      })
      expect(renamed.status).toBe(0)
      expect(fs.readFileSync(path.join(parent, 'to'), 'utf8')).toBe('payload')

      const escaped = spawnSync(helper, ['rename', '../to', 'escaped'], {
        stdio: [fd, 'pipe', 'pipe'],
        encoding: 'utf8',
      })
      expect(escaped.status).not.toBe(0)
      expect(fs.existsSync(path.join(temp, 'escaped'))).toBe(false)

      expect(spawnSync(helper, ['mkdir', 'runtime-dir'], { stdio: [fd, 'pipe', 'pipe'] }).status).toBe(0)
      expect(fs.statSync(path.join(parent, 'runtime-dir')).isDirectory()).toBe(true)
      expect(spawnSync(helper, ['unlink', 'remove-me'], { stdio: [fd, 'pipe', 'pipe'] }).status).toBe(0)
      expect(fs.existsSync(path.join(parent, 'remove-me'))).toBe(false)
      expect(spawnSync(helper, ['rmdir', 'runtime-dir'], { stdio: [fd, 'pipe', 'pipe'] }).status).toBe(0)
      expect(fs.existsSync(path.join(parent, 'runtime-dir'))).toBe(false)
    } finally {
      fs.closeSync(fd)
      fs.rmSync(temp, { recursive: true, force: true })
    }
  })

  it('executes the sandboxed signed lifecycle without touching the host', () => {
    const result = spawnSync('bash', ['runtime-installers/tests/linux-lifecycle.sh'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).not.toMatch(/accepted unsigned|plaintext identity/i)
  })

  it('round-trips only encrypted credential files and preserves the last value on failure', () => {
    const result = spawnSync('bash', ['runtime-installers/tests/linux-credential-helper.sh'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).not.toMatch(/plaintext identity/i)
  })
})
