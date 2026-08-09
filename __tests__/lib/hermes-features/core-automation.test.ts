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
  handleContextSlash,
  handleCompressControlSlash,
  tryHandleHermesFeaturesSlash,
} from '@/lib/hermes-features/slash'
import { SLASH_COMMANDS, getSlashCommandByToken } from '@/lib/chat/slash-commands'
import {
  loadProgressiveSkillBodies,
  readSkillBody,
} from '@/lib/hermes-features/skill-loader'
import { buildDefaultRefDeps } from '@/lib/hermes-features/ref-deps'
import { getConversation, listMessages, convDoc } from '@/lib/conversations/conversations'
import fs from 'fs'
import os from 'os'
import path from 'path'

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: jest.fn(),
  listMessages: jest.fn(),
  convDoc: jest.fn(() => ({ update: jest.fn() })),
}))

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

    it('keeps initial Messages skill dispatch metadata-only with no fallback bodies', async () => {
      const skillId = 'system-auth'
      const body = readSkillBody(skillId)
      expect(body).toBeTruthy()
      expect(body!.length).toBeGreaterThan(40)

      const progressive = loadProgressiveSkillBodies(
        [skillId, 'platform-ops', 'crm-sales'],
        'authenticate API calls with system-auth token',
      )
      expect(progressive.catalog.every((s) => s.loaded === false && s.body === undefined)).toBe(true)
      expect(progressive.bodies).toEqual({})
      expect(progressive.selectedIds).toEqual([])

      await hermesFeaturesService.setSkillCatalog(
        'org1',
        'pip',
        progressive.catalog.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          tags: s.tags,
        })),
      )
      const block = await hermesFeaturesService.buildDispatchBlock({
        orgId: 'org1',
        agentId: 'pip',
        conversationId: 'c-skills',
        userMessage: 'authenticate API calls with system-auth token',
        skillBodies: progressive.bodies,
        skillCatalog: progressive.catalog,
      })
      expect(block.loadedSkillIds).toEqual([])
      expect(block.block).toContain('[Hermes skills — on demand]')
      expect(block.block).toContain('system-auth')
      expect(block.block).not.toContain(body!.slice(0, 40))
    })

    it('default ref deps support @diff and @url (not only file/folder)', () => {
      const deps = buildDefaultRefDeps({
        workspaceFiles: { 'src/a.ts': 'export const a = 1' },
        cwd: process.cwd(),
      })
      expect(typeof deps.gitDiff).toBe('function')
      expect(typeof deps.fetchUrl).toBe('function')
      const diff = hermesFeaturesService.expandContextReference(
        { kind: 'diff', query: 'HEAD' },
        deps,
      )
      // git may return empty or content, but must not be the unavailable-without-dep message
      expect(diff.content).not.toBe('(diff unavailable for HEAD)')
      const url = hermesFeaturesService.expandContextReference(
        { kind: 'url', query: 'https://example.com' },
        deps,
      )
      expect(url.content).not.toBe('(url fetch unavailable: https://example.com)')
      expect(url.content.length).toBeGreaterThan(0)
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
      expect(block.block).not.toContain('CRM SKILL BODY')
      expect(block.block).toContain('crm')
      expect(block.block).toContain('console.log(1)')
      expect(block.checkpointId).toBeTruthy()
      expect(block.loadedSkillIds).toEqual([])
      expect(block.contextFileNames).toContain('AGENTS.md')
    })

    it('keeps workspace instruction files lazy for an ordinary informational run', async () => {
      const ws = hermesFeaturesService.createMemoryWorkspaceFs({
        'AGENTS.md': 'expensive workspace instructions that should remain on disk',
        'src/app.ts': 'console.log(1)',
      })
      const block = await hermesFeaturesService.buildDispatchBlock({
        orgId: 'org1',
        agentId: 'pip',
        conversationId: 'c-read-only',
        userMessage: 'What is the status?',
        workspace: ws,
        includeWorkspaceInstructions: false,
      })
      expect(block.contextFileNames).toEqual([])
      expect(block.block).not.toContain('expensive workspace instructions')
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
      for (const token of ['/toolsets', '/memory', '/rollback', '/personality', '/hermes-features', '/context', '/compress']) {
        expect(getSlashCommandByToken(token)?.executorKind).toBe('hermes_features')
      }
      expect(SLASH_COMMANDS.some((c) => c.id === 'toolsets')).toBe(true)
      expect(SLASH_COMMANDS.some((c) => c.id === 'context')).toBe(true)
      expect(SLASH_COMMANDS.some((c) => c.id === 'compress')).toBe(true)
      expect(getSlashCommandByToken('/context')?.id).toBe('context')
    })

    it('/context reports message counts and compression state without dispatching', async () => {
      const now = Date.now()
      const mk = (id: number, role: 'user' | 'assistant', content: string) => ({
        id: `m${id}`,
        conversationId: 'c1',
        role,
        content,
        authorKind: role === 'user' ? 'user' : 'agent',
        authorId: role === 'user' ? 'peet' : 'pip',
        authorDisplayName: role === 'user' ? 'Peet' : 'Pip',
        status: 'completed',
        createdAt: { toMillis: () => now + id },
      })
      const messages = [
        mk(1, 'user', 'hello'),
        mk(2, 'assistant', 'hi'),
        mk(3, 'user', 'set up billing'),
        mk(4, 'assistant', 'done'),
      ]
      ;(listMessages as jest.Mock).mockResolvedValue(messages)
      ;(getConversation as jest.Mock).mockResolvedValue({
        id: 'c1',
        orgId: 'org1',
        contextCompression: null,
        model: 'deepseek/deepseek-v4-flash',
        provider: 'deepseek',
      })

      const result = await handleContextSlash({ orgId: 'org1', agentId: 'pip', conversationId: 'c1' })
      expect(result.handled).toBe(true)
      expect(result.shouldDispatch).toBe(false)
      expect(result.reply).toContain('**Context usage — this conversation**')
      expect(result.reply).toContain('Messages: 4 (2 user / 2 assistant)')
      expect(result.reply).toContain('Compression: none yet')
      const viaDispatch = await tryHandleHermesFeaturesSlash({
        token: '/context', args: '', orgId: 'org1', agentId: 'pip', conversationId: 'c1',
      })
      expect(viaDispatch?.handled).toBe(true)
    })

    it('/compress status and clear are handled synchronously; a real /compress is not', async () => {
      ;(getConversation as jest.Mock).mockResolvedValue({
        id: 'c1',
        orgId: 'org1',
        contextCompression: {
          summary: 'SUMMARY',
          compressedThroughMessageId: 'm10',
          keepTurns: 5,
          createdAt: '2026-08-06T00:00:00.000Z',
        },
      })
      const status = await tryHandleHermesFeaturesSlash({
        token: '/compress', args: 'status', orgId: 'org1', agentId: 'pip', conversationId: 'c1',
      })
      expect(status?.handled).toBe(true)
      expect(status?.reply).toContain('Context compression (active)')

      const clear = await tryHandleHermesFeaturesSlash({
        token: '/compress', args: 'clear', orgId: 'org1', agentId: 'pip', conversationId: 'c1',
      })
      expect(clear?.handled).toBe(true)
      expect(clear?.reply).toContain('Cleared')
      expect(convDoc).toHaveBeenCalledWith('c1')

      // A real compress falls through to dispatch (handled === null).
      const compress = await tryHandleHermesFeaturesSlash({
        token: '/compress', args: 'here 5', orgId: 'org1', agentId: 'pip', conversationId: 'c1',
      })
      expect(compress).toBeNull()
    })

    it('/compress clear writes the durable conversation field', async () => {
      const update = jest.fn()
      ;(convDoc as jest.Mock).mockReturnValue({ update })
      const result = await handleCompressControlSlash({ orgId: 'org1', conversationId: 'c1', args: 'clear' })
      expect(result.handled).toBe(true)
      expect(update).toHaveBeenCalledWith({ contextCompression: null })
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
