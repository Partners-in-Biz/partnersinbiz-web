/**
 * Gating tests for Hermes Features Overview control plane (Core + Automation + Integrations).
 * Tests drive real shipped modules via hermesFeaturesService — no mock of the unit under test.
 */
import { hermesFeaturesService } from '@/lib/hermes-features/service'
import { hermesFeaturesStore } from '@/lib/hermes-features/store'
import {
  handleToolsetsSlash,
  handleMemorySlash,
  handleRollbackSlash,
  handlePersonalitySlash,
  tryHandleHermesFeaturesSlash,
} from '@/lib/hermes-features/slash'
import { SLASH_COMMANDS, getSlashCommandByToken } from '@/lib/chat/slash-commands'

describe('hermes-features control plane', () => {
  beforeEach(() => {
    hermesFeaturesStore.reset()
  })

  describe('Core 1–6', () => {
    it('enables/disables toolsets and sticks on read-back', () => {
      const enabled = hermesFeaturesService.enableToolset('org1', 'pip', 'browser')
      expect(enabled.enabled).toContain('browser')
      const again = hermesFeaturesService.getToolsets('org1', 'pip')
      expect(again.enabled).toContain('browser')

      const disabled = hermesFeaturesService.disableToolset('org1', 'pip', 'terminal')
      expect(disabled.enabled).not.toContain('terminal')
      expect(hermesFeaturesService.getToolsets('org1', 'pip').enabled).not.toContain('terminal')

      const set = hermesFeaturesService.setToolsets('org1', 'pip', ['web', 'memory', 'skills'])
      expect(set.enabled).toEqual(['web', 'memory', 'skills'])
    })

    it('progressive skills catalog omits bodies until loaded', () => {
      const catalog = hermesFeaturesService.setSkillCatalog('org1', 'pip', [
        { id: 'crm', name: 'CRM', description: 'sales pipeline', body: 'FULL BODY SECRET', tags: ['sales'] },
        { id: 'seo', name: 'SEO', description: 'search sprint', body: 'SEO BODY' },
      ])
      expect(catalog.every((s) => s.loaded === false)).toBe(true)
      expect(catalog.every((s) => s.body === undefined)).toBe(true)

      const loaded = hermesFeaturesService.selectAndLoadSkills('org1', 'pip', 'sales pipeline', {
        crm: 'FULL BODY SECRET',
      })
      const crm = loaded.find((s) => s.id === 'crm')
      expect(crm?.loaded).toBe(true)
      expect(crm?.body).toBe('FULL BODY SECRET')
      expect(loaded.find((s) => s.id === 'seo')?.loaded).toBe(false)
    })

    it('MEMORY.md / USER.md get/set/append round-trips', () => {
      const set = hermesFeaturesService.setMemorySection('org1', 'pip', 'memory', '# MEMORY\n\n- likes TypeScript\n')
      expect(set.memoryMd).toContain('likes TypeScript')
      const appended = hermesFeaturesService.appendMemory('org1', 'pip', 'user', 'prefers dark mode')
      expect(appended.userMd).toContain('prefers dark mode')
      const read = hermesFeaturesService.getMemory('org1', 'pip')
      expect(read.memoryMd).toContain('likes TypeScript')
      expect(read.userMd).toContain('prefers dark mode')
    })

    it('discovers multi-format context files in Hermes order', () => {
      const files = hermesFeaturesService.discoverContextFiles({
        'SOUL.md': 'soul content',
        'AGENTS.md': 'agents content',
        '.hermes.md': 'hermes content',
        'README.md': 'ignored',
        '.cursorrules': 'cursor rules',
      })
      expect(files.map((f) => f.kind)).toEqual(['hermes', 'agents', 'soul', 'cursorrules'])
      expect(files[0].fileName).toBe('.hermes.md')
    })

    it('expands @file / @folder / @diff / @url references', () => {
      const file = hermesFeaturesService.expandContextReference(
        { kind: 'file', query: 'src/a.ts' },
        { readFile: (p) => (p === 'src/a.ts' ? 'export const a = 1' : null) },
      )
      expect(file.content).toContain('export const a = 1')

      const folder = hermesFeaturesService.expandContextReference(
        { kind: 'folder', query: 'src' },
        { listFolder: () => ['a.ts', 'b.ts'] },
      )
      expect(folder.content).toContain('a.ts')

      const diff = hermesFeaturesService.expandContextReference(
        { kind: 'diff', query: 'HEAD' },
        { gitDiff: () => 'diff --git a/x b/x\n+line' },
      )
      expect(diff.content).toContain('diff --git')

      const url = hermesFeaturesService.expandContextReference(
        { kind: 'url', query: 'https://example.com' },
        { fetchUrl: () => '<html>ok</html>' },
      )
      expect(url.content).toContain('<html>ok</html>')

      const expanded = hermesFeaturesService.expandAtTokensInMessage(
        'See @file:src/a.ts and @url:https://example.com',
        {
          readFile: () => 'file body',
          fetchUrl: () => 'url body',
        },
      )
      expect(expanded.expansions).toHaveLength(2)
      expect(expanded.expansions[0].kind).toBe('file')
      expect(expanded.expansions[1].kind).toBe('url')
    })

    it('checkpoint then rollback restores prior snapshot state', () => {
      const snap = hermesFeaturesService.createCheckpoint({
        orgId: 'org1',
        conversationId: 'conv1',
        files: { 'a.ts': 'v1', 'b.ts': 'keep' },
        label: 'before-edit',
      })
      hermesFeaturesService.store.setWorkspaceFiles('org1', 'conv1', {
        'a.ts': 'v2-broken',
        'c.ts': 'new',
      })
      const restored = hermesFeaturesService.rollback('org1', 'conv1', snap.id)
      expect(restored.files['a.ts']).toBe('v1')
      expect(restored.files['b.ts']).toBe('keep')
      expect(restored.restoredPaths).toEqual(expect.arrayContaining(['a.ts', 'b.ts']))
      expect(restored.removedPaths).toContain('c.ts')
      expect(hermesFeaturesService.store.getWorkspaceFiles('org1', 'conv1')['a.ts']).toBe('v1')
    })
  })

  describe('Automation 7–11', () => {
    it('creates lists pauses resumes and edits cron jobs', () => {
      const job = hermesFeaturesService.createCron({
        orgId: 'org1',
        agentId: 'pip',
        name: 'morning brief',
        schedule: 'every weekday at 8am',
        prompt: 'Write a briefing',
      })
      expect(job.status).toBe('active')
      expect(hermesFeaturesService.listCron('org1')).toHaveLength(1)

      const paused = hermesFeaturesService.pauseCron('org1', job.id)
      expect(paused.status).toBe('paused')
      const resumed = hermesFeaturesService.resumeCron('org1', job.id)
      expect(resumed.status).toBe('active')
      const edited = hermesFeaturesService.editCron('org1', job.id, { schedule: '0 8 * * 1-5' })
      expect(edited.schedule).toBe('0 8 * * 1-5')
    })

    it('spawns bounded subagent delegations', () => {
      const spawn = hermesFeaturesService.spawnDelegations({
        parentRunHint: 'msg-1',
        goals: ['audit CRM', 'draft email', 'check SEO', 'fourth ignored by max'],
        maxConcurrent: 3,
      })
      expect(spawn.children).toHaveLength(3)
      expect(spawn.maxConcurrent).toBe(3)
      expect(spawn.children[0].status).toBe('queued')
      expect(spawn.children[0].id).toMatch(/^child_/)
    })

    it('code execution respects toolset gate and runs trivial script', () => {
      const blocked = hermesFeaturesService.executeCode('org1', 'pip', 'print("hi")')
      expect(blocked.toolsetEnabled).toBe(false)
      expect(blocked.ok).toBe(false)

      hermesFeaturesService.enableToolset('org1', 'pip', 'code_execution')
      const ok = hermesFeaturesService.executeCode('org1', 'pip', 'print("hi")')
      expect(ok.ok).toBe(true)
      expect(ok.stdout).toBe('hi\n')
      expect(ok.exitCode).toBe(0)

      const arith = hermesFeaturesService.executeCode('org1', 'pip', 'print(2+3)')
      expect(arith.stdout).toBe('5\n')
    })

    it('creates lists enables disables hooks', () => {
      const hook = hermesFeaturesService.createHook({
        orgId: 'org1',
        kind: 'gateway_log',
        name: 'log-all',
      })
      expect(hermesFeaturesService.listHooks('org1')).toHaveLength(1)
      const disabled = hermesFeaturesService.setHookEnabled('org1', hook.id, false)
      expect(disabled.enabled).toBe(false)
      expect(hermesFeaturesService.listHookKinds()).toContain('tool_guard')
    })

    it('batch runner returns structured per-item results', () => {
      const job = hermesFeaturesService.runBatch({
        orgId: 'org1',
        agentId: 'pip',
        prompts: ['one', 'two', 'three'],
      })
      expect(job.items).toHaveLength(3)
      expect(job.items[0].status).toBe('ok')
      expect(job.items[1].output).toContain('two')
      expect(hermesFeaturesService.listBatch('org1')[0].id).toBe(job.id)
    })
  })

  describe('Media 12–17 product-safe', () => {
    it('reports media readiness and speak/browser contracts', () => {
      const cold = hermesFeaturesService.assessMediaReadiness()
      expect(cold.find((m) => m.capability === 'voice_tts')?.status).toBe('not_ready')

      const hot = hermesFeaturesService.assessMediaReadiness({
        sttConfigured: true,
        ttsProvider: 'elevenlabs',
        browserBackend: 'cdp',
        visionModel: 'grok-4.5',
        imageGenProvider: 'fal',
      })
      expect(hot.every((m) => m.status === 'ready')).toBe(true)

      const speak = hermesFeaturesService.hermesSpeakPath('edge', 'Hello world')
      expect(speak.ok).toBe(true)
      expect(speak.provider).toBe('edge')
      expect(speak.audioHint).toContain('hermes-tts://edge')

      const browser = hermesFeaturesService.browserNavigateExtractContract({
        url: 'https://example.com',
        backend: 'cdp',
      })
      expect(browser.ok).toBe(true)
    })
  })

  describe('Integrations 18–22, 26, 28', () => {
    it('registers MCP servers and filters tools', () => {
      const server = hermesFeaturesService.registerMcp({
        orgId: 'org1',
        name: 'github',
        transport: 'http',
        endpoint: 'https://mcp.example.com',
        toolAllowlist: ['search', 'create_issue'],
        toolDenylist: ['create_issue'],
      })
      expect(hermesFeaturesService.listMcp('org1')).toHaveLength(1)
      const tools = hermesFeaturesService.filterMcpTools(
        ['search', 'create_issue', 'delete'],
        server,
      )
      expect(tools).toEqual(['search'])
    })

    it('provider routing allow/deny/priority sticks on read-back', () => {
      const policy = hermesFeaturesService.setRouting('org1', {
        orgId: 'org1',
        sort: 'priority',
        allowlist: ['xai', 'openai', 'anthropic'],
        denylist: ['anthropic'],
        priority: ['xai', 'openai'],
      })
      expect(hermesFeaturesService.getRouting('org1').denylist).toContain('anthropic')
      const ordered = hermesFeaturesService.applyRouting(policy, ['openai', 'anthropic', 'xai', 'other'])
      expect(ordered).toEqual(['xai', 'openai'])
    })

    it('credential pool rotates on force after failure', () => {
      const pool = hermesFeaturesService.upsertCredentialPool({
        orgId: 'org1',
        provider: 'xai',
        keys: [
          { id: 'k1', label: 'primary', fingerprint: 'fp1', priority: 0 },
          { id: 'k2', label: 'backup', fingerprint: 'fp2', priority: 1 },
        ],
      })
      const first = hermesFeaturesService.selectCredentialKey(pool)
      expect(first?.id).toBe('k1')
      const marked = hermesFeaturesService.markCredentialStatus('org1', 'xai', 'k1', 'rate_limited')
      const next = hermesFeaturesService.selectCredentialKey(marked, { forceRotateFrom: 'k1' })
      expect(next?.id).toBe('k2')
    })

    it('external memory provider adapter returns hits beyond builtin MEMORY/USER', () => {
      const binding = hermesFeaturesService.bindMemoryProvider({
        orgId: 'org1',
        agentId: 'pip',
        provider: 'mem0',
      })
      const result = hermesFeaturesService.externalMemoryLookup(binding, 'preferred timezone')
      expect(result.provider).toBe('mem0')
      expect(result.hits[0].text).toContain('mem0')
    })

    it('lists and applies personality presets', () => {
      const presets = hermesFeaturesService.listPersonalityPresets()
      expect(presets.length).toBeGreaterThan(1)
      const applied = hermesFeaturesService.applyPersonality('org1', 'pip', 'engineer')
      expect(applied.id).toBe('engineer')
      expect(hermesFeaturesService.store.getAppliedPersonality('org1', 'pip')).toBe('engineer')
    })

    it('installs plugins into catalog', () => {
      const plugins = hermesFeaturesService.installPlugin('org1', 'tool-guardrails')
      const installed = plugins.find((p) => p.id === 'tool-guardrails')
      expect(installed?.installed).toBe(true)
      expect(hermesFeaturesService.listPlugins('org1').find((p) => p.id === 'tool-guardrails')?.installed).toBe(true)
    })
  })

  describe('dispatch + slash wiring', () => {
    it('builds dispatch block with toolsets memory context files and architecture note', () => {
      hermesFeaturesService.setMemorySection('org1', 'pip', 'memory', '# MEMORY\n\n- fact\n')
      hermesFeaturesService.store.setWorkspaceFiles('org1', 'conv1', {
        'AGENTS.md': 'project rules',
      })
      hermesFeaturesService.applyPersonality('org1', 'pip', 'concise')
      const block = hermesFeaturesService.buildDispatchBlock({
        orgId: 'org1',
        agentId: 'pip',
        conversationId: 'conv1',
        userMessage: 'hello',
      })
      expect(block.block).toContain('[Hermes toolsets]')
      expect(block.block).toContain('MEMORY.md')
      expect(block.block).toContain('AGENTS.md')
      expect(block.block).toContain('Firestore + /v1/runs')
      expect(block.block).toContain('concise')
    })

    it('slash handlers for toolsets memory rollback personality work', () => {
      const t = handleToolsetsSlash({
        orgId: 'org1',
        agentId: 'pip',
        args: 'enable browser',
      })
      expect(t.reply).toContain('browser')
      expect(hermesFeaturesService.getToolsets('org1', 'pip').enabled).toContain('browser')

      const m = handleMemorySlash({
        orgId: 'org1',
        agentId: 'pip',
        args: 'add ships on Fridays',
      })
      expect(m.reply).toContain('ships on Fridays')

      hermesFeaturesService.createCheckpoint({
        orgId: 'org1',
        conversationId: 'c1',
        files: { x: '1' },
      })
      const r = handleRollbackSlash({
        orgId: 'org1',
        conversationId: 'c1',
        args: 'list',
      })
      expect(r.reply).toContain('Checkpoint')

      const p = handlePersonalitySlash({
        orgId: 'org1',
        agentId: 'pip',
        args: 'apply coach',
      })
      expect(p.reply).toContain('coach')

      const status = tryHandleHermesFeaturesSlash({
        token: '/hermes-features',
        args: '',
        orgId: 'org1',
        agentId: 'pip',
        conversationId: 'c1',
      })
      expect(status?.reply).toContain('Firestore')
      expect(status?.reply).toContain('Deferred')
    })

    it('registers hermes feature slash commands in Messages registry', () => {
      for (const token of ['/toolsets', '/memory', '/rollback', '/personality', '/hermes-features']) {
        const cmd = getSlashCommandByToken(token)
        expect(cmd).not.toBeNull()
        expect(cmd?.executorKind).toBe('hermes_features')
      }
      expect(SLASH_COMMANDS.some((c) => c.id === 'toolsets')).toBe(true)
    })
  })
})
