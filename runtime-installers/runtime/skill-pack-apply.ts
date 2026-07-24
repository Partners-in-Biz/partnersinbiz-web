import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeAgentExternalDirsConfig } from './hermes-profile-lifecycle'

function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PIB_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

function walkFiles(root: string, prefix = ''): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = path.join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

export async function downloadSkillPackArchive(input: {
  url: string
  expectedContentSha256: string
  headers?: Record<string, string>
  fetcher?: typeof fetch
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(input.url, {
    method: 'GET',
    headers: input.headers,
  })
  if (!response.ok) throw new Error(`skill-pack download failed (${response.status})`)
  const contentSha = response.headers.get('x-pib-pack-sha256')
  const archiveSha = response.headers.get('x-pib-archive-sha256')
  if (contentSha !== input.expectedContentSha256) {
    throw new Error('skill-pack content sha256 mismatch')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  if (!archiveSha || digest !== archiveSha) throw new Error('skill-pack archive sha256 mismatch')
  const archivePath = path.join(os.tmpdir(), `pib-skill-pack-${digest}.tgz`)
  fs.writeFileSync(archivePath, bytes, { mode: 0o600 })
  return archivePath
}

export function applySkillPackArchive(input: {
  agentId: string
  archivePath: string
  expectedSha256: string
  env?: NodeJS.ProcessEnv
}): { skillsApplied: boolean; skillsDigest: string; externalDir: string; skillCount: number } {
  const env = input.env ?? process.env
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-skill-extract-'))
  try {
    const result = spawnSync('tar', ['-xzf', input.archivePath, '-C', extractRoot], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || 'tar extract failed')

    const partnersSource = path.join(extractRoot, 'partnersinbiz')
    if (!fs.existsSync(partnersSource)) throw new Error('skill-pack missing partnersinbiz root')

    // Reject path escape / symlinks.
    for (const rel of walkFiles(partnersSource)) {
      if (rel.includes('..') || path.isAbsolute(rel)) throw new Error(`unsafe skill path: ${rel}`)
      const abs = path.join(partnersSource, rel)
      const st = fs.lstatSync(abs)
      if (st.isSymbolicLink()) throw new Error(`symlink rejected: ${rel}`)
    }

    const pibSkillsRoot = path.join(hermesHome(env), 'pib-skills', 'partnersinbiz')
    ensureDir(pibSkillsRoot)
    for (const entry of fs.readdirSync(partnersSource, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const from = path.join(partnersSource, entry.name)
      const to = path.join(pibSkillsRoot, entry.name)
      fs.rmSync(to, { recursive: true, force: true })
      fs.cpSync(from, to, { recursive: true })
    }

    const externalDir = path.join(hermesHome(env), 'agent-skills', input.agentId)
    ensureDir(externalDir)
    const managedPartners = path.join(externalDir, 'partnersinbiz')
    fs.rmSync(managedPartners, { recursive: true, force: true })
    // Prefer symlink to shared cache when possible; fall back to copy.
    try {
      fs.symlinkSync(pibSkillsRoot, managedPartners, 'dir')
    } catch {
      fs.cpSync(pibSkillsRoot, managedPartners, { recursive: true })
    }

    writeAgentExternalDirsConfig({ agentId: input.agentId, externalDir, env })

    const digest = crypto.createHash('sha256')
    digest.update(input.expectedSha256)
    for (const rel of walkFiles(managedPartners).sort()) {
      const bytes = fs.readFileSync(path.join(managedPartners, rel))
      digest.update(`${rel}:${crypto.createHash('sha256').update(bytes).digest('hex')}\n`)
    }

    return {
      skillsApplied: true,
      skillsDigest: digest.digest('hex'),
      externalDir,
      skillCount: fs.readdirSync(partnersSource).length,
    }
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true })
  }
}
