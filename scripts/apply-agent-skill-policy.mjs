#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(__dirname)
const policy = JSON.parse(readFileSync(join(repoRoot, 'config/agent-skill-policy.json'), 'utf8'))

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const rootArgIndex = process.argv.indexOf('--root')
const root = rootArgIndex >= 0 ? process.argv[rootArgIndex + 1] : '/var/lib/hermes'
const apply = args.has('--apply')
const quarantine = args.has('--quarantine-profile-skills')
const updateConfig = !args.has('--no-config')
const selectedAgents = rawArgs
  .filter((arg, index) => {
    if (arg.startsWith('--')) return false
    if (rawArgs[index - 1] === '--root') return false
    return true
  })
  .filter((agentId) => policy.agents[agentId])

const pibSourceRoot = join(root, 'pib-skills', 'partnersinbiz')
const hermesBundledRoot = join(root, 'hermes-agent', 'skills')
const profileRoot = join(root, 'profiles')
const quarantineName = `.policy-quarantine-${policy.version}`

const summary = {
  policyVersion: policy.version,
  root,
  apply,
  quarantine,
  updateConfig,
  agents: {},
  warnings: [],
  nonFatalWarnings: [],
}

function logAction(text) {
  if (!apply) console.log(`[dry-run] ${text}`)
  else console.log(text)
}

function ensureDir(path) {
  if (!apply) return
  mkdirSync(path, { recursive: true })
}

function resetSymlink(target, linkPath) {
  const existing = lstatSafe(linkPath)
  if (existing) {
    if (existing.isSymbolicLink() && readlinkSafe(linkPath) === target) return true
    if (apply) {
      try {
        rmSync(linkPath, { recursive: true, force: true })
      } catch (error) {
        if (error?.code !== 'EACCES') throw error
        summary.nonFatalWarnings.push(`kept locked existing skill link ${linkPath}`)
        logAction(`skip locked existing skill link ${linkPath}`)
        return false
      }
    }
  }
  ensureDir(dirname(linkPath))
  if (apply) {
    try {
      symlinkSync(target, linkPath, 'dir')
    } catch (error) {
      if (error?.code !== 'EACCES') throw error
      summary.nonFatalWarnings.push(`could not create locked skill link ${linkPath}`)
      logAction(`skip locked skill link ${linkPath}`)
      return false
    }
  }
  return true
}

function resetManagedRepoSkillRoot(externalDir) {
  const managedRoot = join(externalDir, 'partnersinbiz')
  logAction(`reset generated repo skill root ${managedRoot}`)
  if (apply) removeManagedRoot(managedRoot)
  ensureDir(managedRoot)
}

function lstatSafe(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

function readlinkSafe(path) {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}

function removeManagedRoot(managedRoot) {
  try {
    rmSync(managedRoot, { recursive: true, force: true })
    return
  } catch (error) {
    const existing = lstatSafe(managedRoot)
    if (error?.code !== 'EACCES' || !existing?.isDirectory()) throw error
    summary.nonFatalWarnings.push(`kept locked generated repo skill root ${managedRoot}`)
    logAction(`keep generated repo skill root ${managedRoot}; cleaning contents in place after EACCES`)
  }

  for (const entry of readdirSync(managedRoot, { withFileTypes: true })) {
    const entryPath = join(managedRoot, entry.name)
    try {
      rmSync(entryPath, { recursive: true, force: true })
    } catch (error) {
      if (error?.code !== 'EACCES') throw error
      summary.nonFatalWarnings.push(`kept locked generated skill entry ${entryPath}`)
      logAction(`keep locked generated skill entry ${entryPath}`)
    }
  }
}

function listSkillDirs(base) {
  const out = []
  if (!existsSync(base)) return out
  const categories = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)

  for (const category of categories) {
    const categoryPath = join(base, category)
    if (existsSync(join(categoryPath, 'SKILL.md'))) {
      out.push(category)
      continue
    }
    for (const entry of readdirSync(categoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillPath = join(categoryPath, entry.name)
      if (existsSync(join(skillPath, 'SKILL.md'))) out.push(`${category}/${entry.name}`)
    }
  }
  return out.sort()
}

function runtimeSkillsFor(agentPolicy) {
  return Array.isArray(agentPolicy.runtimeSkills) && agentPolicy.runtimeSkills.length > 0
    ? agentPolicy.runtimeSkills
    : agentPolicy.pibSkills
}

function replaceExternalDirsInConfig(text, externalDir) {
  const lines = text.split(/\r?\n/)
  const trailingNewline = text.endsWith('\n')
  const skillsIndex = lines.findIndex((line) => /^skills:\s*$/.test(line))
  const externalLines = [`  external_dirs:`, `    - ${externalDir}`]

  if (skillsIndex < 0) {
    const next = trailingNewline || lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
    return [...next, 'skills:', ...externalLines, ''].join('\n')
  }

  let blockEnd = lines.length
  for (let index = skillsIndex + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) {
      blockEnd = index
      break
    }
  }

  const before = lines.slice(0, skillsIndex + 1)
  const block = lines.slice(skillsIndex + 1, blockEnd)
  const after = lines.slice(blockEnd)
  const cleaned = []

  for (let index = 0; index < block.length; index += 1) {
    const line = block[index]
    if (/^\s{2}external_dirs:\s*(?:\[.*\])?\s*$/.test(line)) {
      index += 1
      while (index < block.length && /^\s+-\s+/.test(block[index])) index += 1
      index -= 1
      continue
    }
    cleaned.push(line)
  }

  const nextLines = [...before, ...externalLines, ...cleaned, ...after]
  return nextLines.join('\n').replace(/\n*$/, '\n')
}

function updateProfileConfig(agentId, externalDir) {
  const configPath = join(profileRoot, agentId, 'config.yaml')
  if (!existsSync(configPath)) {
    summary.warnings.push(`${agentId}: profile config missing at ${configPath}`)
    return false
  }

  const current = readFileSync(configPath, 'utf8')
  const next = replaceExternalDirsInConfig(current, externalDir)
  if (current === next) return false

  logAction(`update ${agentId}/config.yaml skills.external_dirs -> ${externalDir}`)
  if (apply) writeFileSync(configPath, next)
  return true
}

function quarantineProfileSkills(agentId, allowedGlobal) {
  const localRoot = join(profileRoot, agentId, 'skills')
  const installed = listSkillDirs(localRoot)
  const allowed = new Set(allowedGlobal)
  const moved = []
  const kept = []
  for (const skill of installed) {
    if (allowed.has(skill)) {
      kept.push(skill)
      continue
    }
    const from = join(localRoot, ...skill.split('/'))
    const to = join(localRoot, quarantineName, ...skill.split('/'))
    moved.push(skill)
    logAction(`quarantine ${agentId}/${skill} -> ${relative(root, to)}`)
    if (apply) {
      mkdirSync(dirname(to), { recursive: true })
      if (existsSync(to)) rmSync(to, { recursive: true, force: true })
      renameSync(from, to)
    }
  }
  return { installed, moved, kept }
}

const agentEntries = Object.entries(policy.agents).filter(([agentId]) => selectedAgents.length === 0 || selectedAgents.includes(agentId))

for (const [agentId, agentPolicy] of agentEntries) {
  const agentSummary = {
    vpsExternalDir: agentPolicy.vpsExternalDir,
    linkedPibSkills: [],
    linkedGlobalSkills: [],
    missingPibSkills: [],
    missingGlobalSkills: [],
    quarantinedProfileSkills: [],
    keptProfileSkills: [],
    profileConfigUpdated: false,
  }
  summary.agents[agentId] = agentSummary

  const externalDir = agentPolicy.vpsExternalDir
  ensureDir(externalDir)
  resetManagedRepoSkillRoot(externalDir)

  for (const skill of runtimeSkillsFor(agentPolicy)) {
    const source = join(pibSourceRoot, ...skill.split('/'))
    const dest = join(externalDir, 'partnersinbiz', skill)
    if (!existsSync(source)) {
      agentSummary.missingPibSkills.push(skill)
      summary.warnings.push(`${agentId}: missing repo skill source ${source}`)
      continue
    }
    if (resetSymlink(source, dest)) {
      agentSummary.linkedPibSkills.push(skill)
      logAction(`link ${agentId}/partnersinbiz/${skill} -> ${relative(root, source)}`)
    }
  }

  for (const skill of agentPolicy.globalSkills) {
    const source = join(hermesBundledRoot, ...skill.split('/'))
    const dest = join(externalDir, ...skill.split('/'))
    if (!existsSync(source)) {
      agentSummary.missingGlobalSkills.push(skill)
      summary.warnings.push(`${agentId}: missing global skill source ${source}`)
      continue
    }
    if (resetSymlink(source, dest)) {
      agentSummary.linkedGlobalSkills.push(skill)
      logAction(`link ${agentId}/${skill} -> ${relative(root, source)}`)
    }
  }

  if (quarantine) {
    const q = quarantineProfileSkills(agentId, agentPolicy.globalSkills)
    agentSummary.quarantinedProfileSkills = q.moved
    agentSummary.keptProfileSkills = q.kept
  }

  if (updateConfig) {
    agentSummary.profileConfigUpdated = updateProfileConfig(agentId, agentPolicy.vpsExternalDir)
  }
}

console.log(JSON.stringify(summary, null, 2))
if (summary.warnings.length > 0) process.exitCode = 2
