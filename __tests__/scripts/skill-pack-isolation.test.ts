/**
 * @jest-environment node
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applySkillPackArchive } from '@/runtime-installers/runtime/skill-pack-apply'

describe('skill pack isolation', () => {
  it('gives each agent a private copy of only its pack skills', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-skill-iso-'))
    const env = { PIB_HERMES_HOME: home, HERMES_HOME: home }

    function pack(skills: string[]): string {
      const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-pack-'))
      for (const skill of skills) {
        const dir = path.join(staging, 'partnersinbiz', skill)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${skill}\n`)
      }
      const archive = path.join(home, `${skills.join('-')}.tgz`)
      expect(spawnSync('tar', ['-czf', archive, '-C', staging, '.'], { encoding: 'utf8' }).status).toBe(0)
      fs.rmSync(staging, { recursive: true, force: true })
      return archive
    }

    applySkillPackArchive({
      agentId: 'pip',
      archivePath: pack(['content-engine']),
      expectedSha256: 'pip',
      env,
    })
    applySkillPackArchive({
      agentId: 'theo',
      archivePath: pack(['software-development']),
      expectedSha256: 'theo',
      env,
    })

    expect(fs.existsSync(path.join(home, 'agent-skills', 'pip', 'partnersinbiz', 'content-engine', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'agent-skills', 'pip', 'partnersinbiz', 'software-development'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'agent-skills', 'theo', 'partnersinbiz', 'software-development', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'agent-skills', 'theo', 'partnersinbiz', 'content-engine'))).toBe(false)
    // Shared cache may hold both; agent trees must not.
    expect(fs.existsSync(path.join(home, 'pib-skills', 'partnersinbiz', 'content-engine'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'pib-skills', 'partnersinbiz', 'software-development'))).toBe(true)

    fs.rmSync(home, { recursive: true, force: true })
  })
})
