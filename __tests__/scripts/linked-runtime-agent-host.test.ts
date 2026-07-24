/**
 * @jest-environment node
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeAgentHostJob } from '@/runtime-installers/runtime/agent-host'

describe('executeAgentHostJob', () => {
  it('creates a Hermes profile skeleton and policy stamp', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-agent-host-'))
    const env = { ...process.env, PIB_HERMES_HOME: home, HERMES_HOME: home }
    const outcome = await executeAgentHostJob({
      jobId: 'job-1',
      kind: 'install',
      status: 'claimed',
      agentId: 'theo',
      policyVersion: '2026-07-24.test',
      keepInSync: true,
      runtimeSkills: ['software-development/plan'],
      pibSkills: [],
      vpsExternalDir: '/var/lib/hermes/agent-skills/theo',
      preferredPort: 8756,
      leaseToken: 'lease',
    }, env, async () => ({ availableAgentIds: [], healthReason: 'hermes_unavailable' }))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.profileCreated).toBe(true)
    expect(outcome.result.policyApplied).toBe(true)
    expect(fs.existsSync(path.join(home, 'profiles', 'theo', '.env'))).toBe(true)
    expect(fs.readFileSync(path.join(home, 'profiles', 'theo', '.env'), 'utf8')).toContain('API_SERVER_PORT=8756')
    expect(fs.existsSync(path.join(home, 'profiles', 'theo', 'pib-desired-agent.json'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'profiles', 'theo', 'pib-skill-policy.json'))).toBe(true)
  })
})
