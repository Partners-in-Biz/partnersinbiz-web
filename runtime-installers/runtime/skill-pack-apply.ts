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

/**
 * Apply a skill pack for one agent only.
 * Shared `pib-skills` is a content-addressed cache; the agent's external_dirs
 * tree is a private copy of *this pack only* — never a symlink to the union.
 */
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

    const skillDirs = fs.readdirSync(partnersSource, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    // Reject path escape / symlinks.
    for (const rel of walkFiles(partnersSource)) {
      if (rel.includes('..') || path.isAbsolute(rel)) throw new Error(`unsafe skill path: ${rel}`)
      const abs = path.join(partnersSource, rel)
      if (fs.lstatSync(abs).isSymbolicLink()) throw new Error(`symlink rejected: ${rel}`)
    }

    // Content-addressed shared cache (dedupe downloads / rebuilds).
    const pibSkillsRoot = path.join(hermesHome(env), 'pib-skills', 'partnersinbiz')
    ensureDir(pibSkillsRoot)
    for (const skillName of skillDirs) {
      const from = path.join(partnersSource, skillName)
      const to = path.join(pibSkillsRoot, skillName)
      fs.rmSync(to, { recursive: true, force: true })
      fs.cpSync(from, to, { recursive: true })
    }

    // Per-agent isolated tree — only this pack's skills, never the shared union.
    const externalDir = path.join(hermesHome(env), 'agent-skills', input.agentId)
    const managedPartners = path.join(externalDir, 'partnersinbiz')
    fs.rmSync(managedPartners, { recursive: true, force: true })
    ensureDir(managedPartners)
    for (const skillName of skillDirs) {
      fs.cpSync(path.join(partnersSource, skillName), path.join(managedPartners, skillName), { recursive: true })
    }

    writeAgentExternalDirsConfig({ agentId: input.agentId, externalDir, env })

    const digest = crypto.createHash('sha256')
    digest.update(input.expectedSha256)
    for (const rel of walkFiles(managedPartners).sort()) {
      const bytes = fs.readFileSync(path.join(managedPartners, rel))
      digest.update(`${rel}:${crypto.createHash('sha256').update(bytes).digest('hex')}\n`)
    }
    const skillsDigest = digest.digest('hex')
    const digestFile = path.join(hermesHome(env), 'profiles', input.agentId, 'pib-skills-digest.txt')
    const alreadyPersisted = fs.existsSync(digestFile)
      && fs.readFileSync(digestFile, 'utf8').trim() === skillsDigest
    if (!alreadyPersisted) {
      ensureDir(path.dirname(digestFile))
      fs.writeFileSync(digestFile, `${skillsDigest}\n`, { encoding: 'utf8', mode: 0o600 })
    }

    return {
      skillsApplied: true,
      skillsDigest,
      externalDir,
      skillCount: skillDirs.length,
    }
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true })
  }
}

export function removeAgentSkillTree(input: {
  agentId: string
  env?: NodeJS.ProcessEnv
}): { removed: boolean; externalDir: string } {
  const env = input.env ?? process.env
  const externalDir = path.join(hermesHome(env), 'agent-skills', input.agentId)
  const existed = fs.existsSync(externalDir)
  fs.rmSync(externalDir, { recursive: true, force: true })
  return { removed: existed, externalDir }
}
