/**
 * Gating tests for durable Hermes Features control plane.
 * Uses MemoryHermesFeaturesRepository (same interface as Firestore) via service.
 */
import { hermesFeaturesService } from '@/lib/hermes-features/service'
import { setHermesFeaturesRepositoryForTests, createMemoryRepository } from '@/lib/hermes-features/repository'
import {
  handleToolsetsSlash,
  handleMemorySlash,
  handleRollbackSlash,
  handlePersonalitySlash,
  tryHandleHermesFeaturesSlash,
} from '@/lib/hermes-features/slash'
import { SLASH_COMMANDS, getSlashCommandByToken } from '@/lib/chat/slash-commands'
import fs from 'fs'
import os from 'os'
import path from 'path'

describe('hermes-features durable control plane', () => {
  beforeEach(() => {
    hermesFeaturesService.useMemoryRepositoryForTests()
  })

  afterEach(() => {
    setHermesFeaturesRepositoryForTests(null)
  })

  describe('Core 1–6 durable', () => {
    it('toolsets stick on read-back through repository', async () => {
      await hermesFeaturesService.enableToolset('org1', 'pip', 'browser')
      const again = await hermesFeaturesService.getToolsets('org1', 'pip')
      expect(again.enabled).toContain('browser')
      await hermesFeaturesService.disableToolset('org1', 'pip', 'terminal')
      expect((await hermesFeaturesService.getToolsets('org1', 'pip')).enabled).not.toContain('terminal')
    })

    it('progressive skills catalog omits bodies until loaded', async () => {
      const catalog = await hermesFeaturesService.setSkillCatalog('org1', 'pip', [
        { id: 'crm', name: 'CRM', description: 'sales pipeline', body: 'FULL BODY SECRET', tags: ['sales'] },
      ])
      expect(catalog[0].loaded).toBe(false)
      expect(catalog[0].body).toBeUndefined()
      const loaded = await hermesFeaturesService.selectAndLoadSkills('org1', 'pip', 'sales', { crm: 'FULL BODY SECRET' })
      expect(loaded.find((s) => s.id === 'crm')?.body).toBe('FULL BODY SECRET')
    })

    it('MEMORY.md survives repository reset isolation and read-back', async () => {
      await hermesFeaturesService.setMemorySection('org1', 'pip', 'memory', '# MEMORY\n\n- likes TypeScript\n')
      await hermesFeaturesService.appendMemory('org1', 'pip', 'user', 'prefers dark mode')
      const read = await hermesFeaturesService.getMemory('org1', 'pip')
      expect(read.memoryMd).toContain('likes TypeScript')
      expect(read.userMd).toContain('prefers dark mode')
    })

    it('discovers multi-format context files from workspace FS and rolls back writes', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ws-'))
      try {
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'agents rules')
        fs.writeFileSync(path.join(dir, 'SOUL.md'), 'soul')
        fs.writeFileSync(path.join(dir, '.hermes.md'), 'hermes')
        fs.writeFileSync(path.join(dir, 'note.txt'), 'v1')
        const ws = hermesFeaturesService.createNodeWorkspaceFs(dir)!
        expect(ws.discoverContextFiles().map((f) => f.kind)).toEqual(
          expect.arrayContaining(['hermes', 'agents', 'soul']),
        )

        const snap = await hermesFeaturesService.createCheckpoint({
          orgId: 'org1',
          conversationId: 'c1',
          workspace: ws,
          label: 'before',
        })
        fs.writeFileSync(path.join(dir, 'note.txt'), 'v2-broken')
        const restored = await hermesFeaturesService.rollback({
          orgId: 'org1',
          conversationId: 'c1',
          checkpointId: snap.id,
          workspace: ws,
        })
        expect(restored.files['note.txt']).toBe('v1')
        expect(fs.readFileSync(path.join(dir, 'note.txt'), 'utf8')).toBe('v1')
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it('expands @file/@folder/@diff/@url with deps', () => {
      const file = hermesFeaturesService.expandContextReference(
        { kind: 'file', query: 'src/a.ts' },
        { readFile: () => 'export const a = 1' },
      )
      expect(file.content).toContain('export const a = 1')
      const expanded = hermesFeaturesService.expandAtTokensInMessage(
        'See @file:src/a.ts and @url:https://example.com',
        { readFile: () => 'file body', fetchUrl: () => 'url body' },
      )
      expect(expanded.expansions).toHaveLength(2)
    })

    it('dispatch auto-checkpoints and injects discovered context files', async () => {
      const ws = hermesFeaturesService.createMemoryWorkspaceFs({
        'AGENTS.md': 'project rules',
        'src/app.ts': 'console.log(1)',
      })
      await hermesFeaturesService.setMemorySection('org1', 'pip', 'memory', '# MEMORY\n- fact\n')
      await hermesFeaturesService.applyPersonality('org1', 'pip', 'concise')
      await hermesFeaturesService.setSkillCatalog('org1', 'pip', [
        { id: 'crm', name: 'CRM', description: 'pipeline', tags: ['crm'] },
      ])
      const block = await hermesFeaturesService.buildDispatchBlock({
        orgId: 'org1',
        agentId: 'pip',
        conversationId: 'c1',
        userMessage: 'crm pipeline please @file:src/app.ts',
        workspace: ws,
        skillBodies: { crm: 'CRM SKILL BODY' },
        autoCheckpoint: true,
      })
      expect(block.block).toContain('AGENTS.md')
      expect(block.block).toContain('CRM SKILL BODY')
      expect(block.block).toContain('console.log(1)')
      expect(block.checkpointId).toBeTruthy()
      expect(block.loadedSkillIds).toContain('crm')
      expect(block.contextFileNames).toContain('AGENTS.md')
    })
  })

  describe('Automation 7–11 real paths', () => {
    it('creates cron and fires via createRun dependency (Hermes run path)', async () => {
      const runs: string[] = []
      const job = await hermesFeaturesService.createCron(
        {
          orgId: 'org1',
          agentId: 'pip',
          name: 'brief',
          schedule: '@hourly',
          prompt: 'Write a briefing',
        },
        {
          syncToHermes: async () => ({ ok: true, detail: 'synced' }),
          createRun: async ({ prompt, jobId }) => {
            runs.push(`${jobId}:${prompt}`)
            return { ok: true, runId: `run_${jobId}` }
          },
        },
      )
      expect(job.hermesSynced).toBe(true)
      expect(job.nextRunAt).toBeTruthy()

      const fired = await hermesFeaturesService.fireCron('org1', job.id, {
        createRun: async ({ prompt, jobId }) => {
          runs.push(`fire:${jobId}`)
          return { ok: true, runId: `run_fire_${jobId}` }
        },
      })
      expect(fired.lastFireRunId).toMatch(/^run_fire_/)
      expect(runs.some((r) => r.startsWith('fire:'))).toBe(true)
    })

    it('spawns observable delegation children with run ids', async () => {
      const record = await hermesFeaturesService.spawnObservableDelegations(
        {
          orgId: 'org1',
          agentId: 'pip',
          conversationId: 'c1',
          parentRunHint: 'parent-1',
          goals: ['audit CRM', 'draft email'],
          maxConcurrent: 2,
        },
        {
          createRun: async ({ childId, goal }) => ({
            ok: true,
            runId: `hermes-${childId}`,
            runDocId: `doc-${childId}`,
          }),
        },
      )
      expect(record.children).toHaveLength(2)
      expect(record.children[0].status).toBe('running')
      expect(record.children[0].runId).toMatch(/^hermes-child_/)
      const observed = await hermesFeaturesService.observeDelegation('org1', record.id)
      expect(observed?.children[1].runId).toBeTruthy()
    })

    it('code execution respects toolset gate', async () => {
      const blocked = await hermesFeaturesService.executeCode('org1', 'pip', 'print("hi")')
      expect(blocked.ok).toBe(false)
      await hermesFeaturesService.enableToolset('org1', 'pip', 'code_execution')
      const ok = await hermesFeaturesService.executeCode('org1', 'pip', 'print("hi")')
      expect(ok.stdout).toBe('hi\n')
    })

    it('hooks and batch durable list', async () => {
      await hermesFeaturesService.createHook({ orgId: 'org1', kind: 'gateway_log', name: 'log' })
      expect(await hermesFeaturesService.listHooks('org1')).toHaveLength(1)
      const batch = await hermesFeaturesService.runBatch({
        orgId: 'org1',
        agentId: 'pip',
        prompts: ['a', 'b'],
        runner: (p, i) => ({ status: 'ok', output: `real-${i}:${p}` }),
      })
      expect(batch.items[0].output).toBe('real-0:a')
    })
  })

  describe('Media honesty', () => {
    it('reports not_ready without env and ready with config', () => {
      const cold = hermesFeaturesService.assessMediaReadiness({
        sttConfigured: false,
        ttsProvider: null,
        browserBackend: null,
        visionModel: null,
        imageGenProvider: null,
      })
      expect(cold.every((m) => m.status === 'not_ready')).toBe(true)
      const speak = hermesFeaturesService.hermesSpeakPath(null, 'hi')
      expect(speak.ok).toBe(false)
      expect(speak.status).toBe('not_ready')
      const hotSpeak = hermesFeaturesService.hermesSpeakPath('edge', 'hi')
      expect(hotSpeak.ok).toBe(true)
      expect(hotSpeak.hermesToolHint).toContain('tts.speak')
    })
  })

  describe('Integrations durable + honest external memory', () => {
    it('MCP routing credentials personality plugins durable', async () => {
      await hermesFeaturesService.registerMcp({
        orgId: 'org1',
        name: 'github',
        transport: 'http',
        endpoint: 'https://mcp.example.com',
        toolAllowlist: ['search'],
      })
      expect(await hermesFeaturesService.listMcp('org1')).toHaveLength(1)

      await hermesFeaturesService.setRouting('org1', {
        orgId: 'org1',
        priority: ['xai', 'openai'],
        allowlist: ['xai', 'openai'],
        denylist: [],
      })
      const ordered = hermesFeaturesService.applyRouting(
        await hermesFeaturesService.getRouting('org1'),
        ['openai', 'xai'],
      )
      expect(ordered).toEqual(['xai', 'openai'])

      await hermesFeaturesService.upsertCredentialPool({
        orgId: 'org1',
        provider: 'xai',
        keys: [
          { id: 'k1', label: 'a', fingerprint: 'fp1', priority: 0 },
          { id: 'k2', label: 'b', fingerprint: 'fp2', priority: 1 },
        ],
      })
      const pool = (await hermesFeaturesService.listCredentialPools('org1'))[0]
      const marked = await hermesFeaturesService.markCredentialStatus('org1', 'xai', 'k1', 'rate_limited')
      const next = hermesFeaturesService.selectCredentialKey(marked, { forceRotateFrom: 'k1' })
      expect(next?.id).toBe('k2')
      expect(pool.keys[0].fingerprint).toBe('fp1')

      await hermesFeaturesService.applyPersonality('org1', 'pip', 'engineer')
      expect(await hermesFeaturesService.getAppliedPersonality('org1', 'pip')).toBe('engineer')
      await hermesFeaturesService.installPlugin('org1', 'tool-guardrails')
      expect((await hermesFeaturesService.listPlugins('org1')).find((p) => p.id === 'tool-guardrails')?.installed).toBe(true)
    })

    it('external memory does not fabricate hits when not ready', async () => {
      const binding = await hermesFeaturesService.bindMemoryProvider({
        orgId: 'org1',
        agentId: 'pip',
        provider: 'mem0',
        config: {},
      })
      const cold = await hermesFeaturesService.externalMemoryLookup(binding, 'timezone')
      expect(cold.ready).toBe(false)
      expect(cold.hits).toEqual([])

      const ready = await hermesFeaturesService.externalMemoryLookup(
        { ...binding, config: { apiKey: 'test' } },
        'timezone',
        {
          mem0Lookup: async (q) => [{ id: '1', text: `real mem0: ${q}` }],
        },
      )
      expect(ready.ready).toBe(true)
      expect(ready.hits[0].text).toContain('real mem0')
    })
  })

  describe('slash + registry', () => {
    it('async slash handlers mutate durable state', async () => {
      const t = await handleToolsetsSlash({
        orgId: 'org1',
        agentId: 'pip',
        args: 'enable browser',
      })
      expect(t.reply).toContain('browser')
      expect((await hermesFeaturesService.getToolsets('org1', 'pip')).enabled).toContain('browser')

      const m = await handleMemorySlash({
        orgId: 'org1',
        agentId: 'pip',
        args: 'add ships on Fridays',
      })
      expect(m.reply).toContain('ships on Fridays')

      const ws = hermesFeaturesService.createMemoryWorkspaceFs({ a: '1' })
      await hermesFeaturesService.createCheckpoint({
        orgId: 'org1',
        conversationId: 'c1',
        workspace: ws,
      })
      const r = await handleRollbackSlash({
        orgId: 'org1',
        conversationId: 'c1',
        args: 'list',
      })
      expect(r.reply).toContain('Checkpoint')

      const p = await handlePersonalitySlash({
        orgId: 'org1',
        agentId: 'pip',
        args: 'apply coach',
      })
      expect(p.reply).toContain('coach')

      const status = await tryHandleHermesFeaturesSlash({
        token: '/hermes-features',
        args: '',
        orgId: 'org1',
        agentId: 'pip',
        conversationId: 'c1',
      })
      expect(status?.reply).toContain('Partial')
    })

    it('registers slash commands', () => {
      for (const token of ['/toolsets', '/memory', '/rollback', '/personality', '/hermes-features']) {
        expect(getSlashCommandByToken(token)?.executorKind).toBe('hermes_features')
      }
      expect(SLASH_COMMANDS.some((c) => c.id === 'toolsets')).toBe(true)
    })
  })

  it('memory repository instances are isolated (durability interface)', async () => {
    const a = createMemoryRepository()
    const b = createMemoryRepository()
    await a.setMemory({
      orgId: 'o',
      agentId: 'pip',
      memoryMd: 'only-a',
      userMd: '',
      updatedAt: new Date().toISOString(),
    })
    expect((await b.getMemory('o', 'pip')).memoryMd).not.toContain('only-a')
    expect((await a.getMemory('o', 'pip')).memoryMd).toContain('only-a')
  })
})
