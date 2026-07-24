import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { AGENT_SKILL_POLICY, getAgentSkillPolicy } from '@/lib/agents/skill-policy'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

const SKILLS_ROOT = path.join(process.cwd(), 'packs', 'pib-system-skills', 'skills')

export interface SkillPackFile {
  path: string
  sha256: string
  size: number
}

export interface SkillPackManifest {
  agentId: AgentId
  policyVersion: string
  catalogVersion: string
  packSha256: string
  skillNames: string[]
  files: SkillPackFile[]
  byteSize: number
}

function walkFiles(root: string, prefix = ''): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

function safeSkillName(name: string): string | null {
  const clean = name.trim()
  if (!clean || clean.includes('..') || clean.includes('\\') || clean.startsWith('/') || clean.includes('\0')) {
    return null
  }
  return clean
}

export function skillNamesForAgent(agentId: AgentId): string[] {
  const policy = getAgentSkillPolicy(agentId)
  const names = [...new Set([
    ...(policy?.runtimeSkills ?? []),
    ...(policy?.pibSkills ?? []),
  ])]
    .map(safeSkillName)
    .filter((value): value is string => Boolean(value))
  return names.sort()
}

export function buildSkillPackManifest(agentId: AgentId): SkillPackManifest {
  if (!isValidAgentId(agentId)) throw new Error('skill-pack: invalid agentId')
  const skillNames = skillNamesForAgent(agentId)
  const files: SkillPackFile[] = []
  const hash = crypto.createHash('sha256')
  hash.update(`agent:${agentId}\npolicy:${AGENT_SKILL_POLICY.version}\n`)

  for (const skillName of skillNames) {
    const skillRoot = path.join(SKILLS_ROOT, skillName)
    if (!fs.existsSync(skillRoot)) continue
    const relFiles = walkFiles(skillRoot).sort()
    for (const rel of relFiles) {
      const abs = path.join(skillRoot, rel)
      const bytes = fs.readFileSync(abs)
      const filePath = `${skillName}/${rel}`
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
      files.push({ path: filePath, sha256, size: bytes.length })
      hash.update(`${filePath}:${sha256}:${bytes.length}\n`)
    }
  }

  const packSha256 = hash.digest('hex')
  return {
    agentId,
    policyVersion: AGENT_SKILL_POLICY.version,
    catalogVersion: AGENT_SKILL_POLICY.catalogVersion ?? AGENT_SKILL_POLICY.version,
    packSha256,
    skillNames,
    files,
    byteSize: files.reduce((sum, file) => sum + file.size, 0),
  }
}

/** Build a gzipped tar of the agent skill pack into a temp file. Caller must unlink. */
export function materializeSkillPackTarGz(agentId: AgentId, expectedContentSha256?: string): {
  manifest: SkillPackManifest
  archivePath: string
  archiveSha256: string
} {
  const manifest = buildSkillPackManifest(agentId)
  if (expectedContentSha256 && expectedContentSha256 !== manifest.packSha256) {
    throw new Error('skill-pack: digest mismatch')
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-skill-pack-'))
  const partnersRoot = path.join(staging, 'partnersinbiz')
  fs.mkdirSync(partnersRoot, { recursive: true })

  for (const skillName of manifest.skillNames) {
    const source = path.join(SKILLS_ROOT, skillName)
    if (!fs.existsSync(source)) continue
    const destination = path.join(partnersRoot, skillName)
    fs.cpSync(source, destination, { recursive: true })
  }

  fs.writeFileSync(
    path.join(staging, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )

  const archivePath = path.join(os.tmpdir(), `pib-skill-pack-${manifest.packSha256}.tgz`)
  const result = spawnSync('tar', ['-czf', archivePath, '-C', staging, '.'], { encoding: 'utf8' })
  fs.rmSync(staging, { recursive: true, force: true })
  if (result.status !== 0) {
    throw new Error(`skill-pack: tar failed: ${result.stderr || result.stdout || 'unknown error'}`)
  }
  const archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
  return { manifest, archivePath, archiveSha256 }
}
