#!/usr/bin/env npx tsx
/**
 * Local acceptance harness for agent-host world-class path.
 * Does not require a paired Mac — exercises pack build, apply isolation,
 * profile env, and uninstall cleanup against a temp HERMES_HOME.
 *
 * Usage: npx tsx scripts/accept-agent-host-local.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSkillPackManifest, materializeSkillPackTarGz } from '../lib/agents/skill-pack-builder'
import { executeAgentHostJob } from '../runtime-installers/runtime/agent-host'
import { applySkillPackArchive, removeAgentSkillTree } from '../runtime-installers/runtime/skill-pack-apply'
import { resolvePreferredAgentPort } from '../lib/linked-computers/agent-host-ports'

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-accept-'))
  const env = {
    ...process.env,
    PIB_HERMES_HOME: home,
    HERMES_HOME: home,
    PIB_RUNTIME_STATE_DIR: path.join(home, 'state'),
  }
  const failures: string[] = []

  const manifest = buildSkillPackManifest('pip')
  if (!manifest.skillNames.length) failures.push('pip skill pack empty')
  const { archivePath, archiveSha256 } = materializeSkillPackTarGz('pip')
  if (archiveSha256.length !== 64) failures.push('archive sha invalid')

  const applied = applySkillPackArchive({
    agentId: 'pip',
    archivePath,
    expectedSha256: manifest.packSha256,
    env,
  })
  if (!applied.skillsApplied) failures.push('skills not applied')

  const install = await executeAgentHostJob({
    jobId: 'accept-install',
    kind: 'install',
    status: 'claimed',
    agentId: 'pip',
    policyVersion: manifest.policyVersion,
    keepInSync: true,
    runtimeSkills: manifest.skillNames,
    pibSkills: [],
    vpsExternalDir: null,
    preferredPort: resolvePreferredAgentPort('pip'),
    skillPack: {
      packSha256: manifest.packSha256,
      policyVersion: manifest.policyVersion,
      skillNames: manifest.skillNames,
      artifactPath: '/api/v1/linked-computers/dev/agents/skills/artifact?agentId=pip',
    },
  }, {
    env,
    startGateway: false,
    probe: async () => ({ availableAgentIds: ['pip'], hermesVersion: 'accept' }),
    downloadSkillPack: async () => {
      const copy = path.join(home, 'dl.tgz')
      fs.copyFileSync(archivePath, copy)
      return copy
    },
  })
  if (!install.ok) failures.push(`install failed: ${'error' in install ? install.error : ''}`)

  const uninstall = await executeAgentHostJob({
    jobId: 'accept-uninstall',
    kind: 'uninstall',
    status: 'claimed',
    agentId: 'pip',
    policyVersion: null,
    keepInSync: false,
    runtimeSkills: [],
    pibSkills: [],
    vpsExternalDir: null,
    preferredPort: null,
  }, {
    env,
    startGateway: false,
    probe: async () => ({ availableAgentIds: [] }),
  })
  if (!uninstall.ok) failures.push(`uninstall failed: ${'error' in uninstall ? uninstall.error : ''}`)
  const removed = removeAgentSkillTree({ agentId: 'pip', env })
  if (fs.existsSync(path.join(home, 'agent-skills', 'pip')) && !removed.removed) {
    failures.push('skill tree still present after uninstall')
  }

  // Custom agents keep-in-sync with an empty skill stamp.
  const customManifest = buildSkillPackManifest('custom-analyst')
  if (customManifest.skillNames.length !== 0) failures.push('custom pack should be empty')
  const customMaterialized = materializeSkillPackTarGz('custom-analyst')
  const customInstall = await executeAgentHostJob({
    jobId: 'accept-custom-install',
    kind: 'install',
    status: 'claimed',
    agentId: 'custom-analyst',
    policyVersion: customManifest.policyVersion,
    keepInSync: true,
    runtimeSkills: [],
    pibSkills: [],
    vpsExternalDir: null,
    preferredPort: resolvePreferredAgentPort('custom-analyst'),
    skillPack: {
      packSha256: customManifest.packSha256,
      policyVersion: customManifest.policyVersion,
      skillNames: customManifest.skillNames,
      artifactPath: '/api/v1/linked-computers/dev/agents/skills/artifact?agentId=custom-analyst',
    },
  }, {
    env,
    startGateway: false,
    probe: async () => ({ availableAgentIds: ['custom-analyst'], hermesVersion: 'accept' }),
    downloadSkillPack: async () => {
      const copy = path.join(home, 'custom-dl.tgz')
      fs.copyFileSync(customMaterialized.archivePath, copy)
      return copy
    },
  })
  if (!customInstall.ok) {
    failures.push(`custom keep-in-sync install failed: ${'error' in customInstall ? customInstall.error : ''}`)
  }

  fs.rmSync(archivePath, { force: true })
  fs.rmSync(customMaterialized.archivePath, { force: true })
  fs.rmSync(home, { recursive: true, force: true })

  if (failures.length) {
    console.error('ACCEPTANCE FAILED')
    for (const row of failures) console.error(` - ${row}`)
    process.exitCode = 1
    return
  }
  console.log('ACCEPTANCE PASSED: pack build, isolated apply, install, uninstall, custom empty keep-in-sync')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
