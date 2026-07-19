import fs from 'node:fs'
import path from 'node:path'
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { canonicalJson, type ReleaseManifest } from '../runtime-installers/runtime/core'

export type RuntimeTarget = `${'macos' | 'windows' | 'linux'}-${'x64' | 'arm64'}`

const TARGET = /^(macos|windows|linux)-(x64|arm64)$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function runtimeReleaseAssetNames(target: RuntimeTarget) {
  const [platform] = target.split('-')
  const prefix = `partnersinbiz-runtime-${target}`
  return {
    payload: `${prefix}${platform === 'windows' ? '.exe' : ''}`,
    metadata: `${prefix}-stable.json`,
    signature: `${prefix}-stable.json.sig`,
    installer: `${prefix}-installer.${platform === 'windows' ? 'cab' : platform === 'macos' ? 'pkg' : 'tgz'}`,
  }
}

export function createRuntimeReleaseManifest(input: {
  target: RuntimeTarget
  version: string
  minimumVersion: string
  payload: Buffer
  payloadUrl: string
}): ReleaseManifest {
  if (!TARGET.test(input.target)) throw new Error(`Unsupported runtime target: ${input.target}`)
  if (!SEMVER.test(input.version) || !SEMVER.test(input.minimumVersion)) throw new Error('Runtime release versions must be SemVer')
  const [platform, architecture] = input.target.split('-')
  return {
    channel: 'stable',
    platform,
    architecture,
    version: input.version,
    minimumVersion: input.minimumVersion,
    sha256: createHash('sha256').update(input.payload).digest('hex'),
    payloadUrl: input.payloadUrl,
  }
}

function argument(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? '' : fallback
}

function archiveInstaller(input: { root: string; stage: string; destination: string; target: RuntimeTarget; version: string }) {
  const [platform, architecture] = input.target.split('-')
  let archiveStage = input.stage
  let cleanStage = ''
  if (platform === 'macos') {
    cleanStage = path.join(path.dirname(input.stage), `.package-${architecture}-${process.pid}`)
    fs.rmSync(cleanStage, { force: true, recursive: true })
    const copy = spawnSync('ditto', ['--norsrc', '--noextattr', input.stage, cleanStage], { stdio: 'inherit' })
    if (copy.status !== 0) throw new Error(`Could not prepare clean macOS package contents for ${input.target}`)
    archiveStage = cleanStage
  }
  const command = platform === 'windows' ? 'powershell.exe' : platform === 'macos' ? 'pkgbuild' : 'tar'
  const args = platform === 'windows'
    ? [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(input.root, 'scripts/package-windows-installer.ps1'),
        '-Stage', archiveStage,
        '-Destination', input.destination,
      ]
    : platform === 'macos'
      ? [
        '--root', archiveStage,
        '--identifier', `online.partnersinbiz.linked-runtime.${architecture}`,
        '--version', input.version,
        '--install-location', `/Library/Application Support/PartnersInBiz/Installer-${architecture}`,
        input.destination,
      ]
      : ['-czf', input.destination, '-C', input.stage, '.']
  const result = spawnSync(command, args, {
    cwd: platform === 'windows' ? archiveStage : process.cwd(),
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: 'inherit',
  })
  if (cleanStage) fs.rmSync(cleanStage, { force: true, recursive: true })
  if (result.status !== 0) throw new Error(`Could not create ${path.basename(input.destination)}`)
}

export function packageRuntimeRelease(input: {
  root: string
  distDir: string
  outputDir: string
  targets: RuntimeTarget[]
  version: string
  minimumVersion: string
  tag: string
  privateKeyPem: string
}) {
  const key = createPrivateKey(input.privateKeyPem)
  const expectedPublicKey = fs.readFileSync(path.join(input.root, 'runtime-installers/release-public.pem'), 'utf8').trim()
  const actualPublicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString().trim()
  if (actualPublicKey !== expectedPublicKey) throw new Error('Runtime release private key does not match the committed public key')
  fs.mkdirSync(input.outputDir, { recursive: true })
  for (const target of input.targets) {
    if (!TARGET.test(target)) throw new Error(`Unsupported runtime target: ${target}`)
    const stage = path.join(input.distDir, target)
    const [platform] = target.split('-')
    const binary = path.join(stage, `pib-runtime${platform === 'windows' ? '.exe' : ''}`)
    if (!fs.existsSync(binary)) throw new Error(`Missing compiled runtime: ${binary}`)
    const publicKey = path.join(input.root, 'runtime-installers/release-public.pem')
    fs.copyFileSync(publicKey, path.join(stage, 'release-public.pem'))
    const names = runtimeReleaseAssetNames(target)
    const payload = fs.readFileSync(binary)
    const payloadUrl = `https://github.com/Partners-in-Biz/partnersinbiz-web/releases/download/${input.tag}/${names.payload}`
    const manifest = createRuntimeReleaseManifest({
      target, version: input.version, minimumVersion: input.minimumVersion, payload, payloadUrl,
    })
    fs.copyFileSync(binary, path.join(input.outputDir, names.payload))
    fs.writeFileSync(path.join(input.outputDir, names.metadata), `${JSON.stringify(manifest, null, 2)}\n`)
    fs.writeFileSync(path.join(input.outputDir, names.signature), `${sign(null, Buffer.from(canonicalJson(manifest)), key).toString('base64url')}\n`)
    archiveInstaller({
      root: input.root,
      stage,
      destination: path.join(input.outputDir, names.installer),
      target,
      version: input.version,
    })
  }
}

if (require.main === module) {
  const root = process.cwd()
  const version = argument('--version')
  const minimumVersion = argument('--minimum-version', version)
  const tag = argument('--tag', `runtime-v${version}`)
  const targets = argument('--targets', 'linux-x64,linux-arm64').split(',').filter(Boolean) as RuntimeTarget[]
  const privateKeyPem = process.env.PIB_RUNTIME_RELEASE_PRIVATE_KEY ?? ''
  if (!version || !privateKeyPem) throw new Error('Usage requires --version and PIB_RUNTIME_RELEASE_PRIVATE_KEY')
  packageRuntimeRelease({
    root,
    distDir: path.resolve(argument('--dist', 'runtime-installers/dist')),
    outputDir: path.resolve(argument('--output', 'runtime-installers/release-dist')),
    targets,
    version,
    minimumVersion,
    tag,
    privateKeyPem,
  })
}
