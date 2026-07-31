/**
 * GET/POST /api/v1/admin/hermes-features
 * Control plane for Hermes Features Overview productization in PiB.
 * Architecture: Firestore conversations + /v1/runs adapters (not SessionDB).
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { hermesFeaturesService } from '@/lib/hermes-features/service'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId') || 'pib'
  const agentId = url.searchParams.get('agentId') || 'pip'
  const conversationId = url.searchParams.get('conversationId') || undefined
  const section = url.searchParams.get('section') || 'snapshot'

  try {
    if (section === 'toolsets') {
      return apiSuccess({ toolsets: hermesFeaturesService.getToolsets(orgId, agentId, conversationId) })
    }
    if (section === 'skills') {
      return apiSuccess({ skills: hermesFeaturesService.listSkills(orgId, agentId) })
    }
    if (section === 'memory') {
      return apiSuccess({ memory: hermesFeaturesService.getMemory(orgId, agentId) })
    }
    if (section === 'cron') {
      return apiSuccess({ cronJobs: hermesFeaturesService.listCron(orgId) })
    }
    if (section === 'hooks') {
      return apiSuccess({ hooks: hermesFeaturesService.listHooks(orgId), kinds: hermesFeaturesService.listHookKinds() })
    }
    if (section === 'mcp') {
      return apiSuccess({ mcpServers: hermesFeaturesService.listMcp(orgId) })
    }
    if (section === 'routing') {
      return apiSuccess({ routing: hermesFeaturesService.getRouting(orgId) })
    }
    if (section === 'credential-pools') {
      return apiSuccess({ pools: hermesFeaturesService.listCredentialPools(orgId) })
    }
    if (section === 'memory-providers') {
      return apiSuccess({ providers: hermesFeaturesService.listMemoryProviders(orgId, agentId) })
    }
    if (section === 'personality') {
      return apiSuccess({
        presets: hermesFeaturesService.listPersonalityPresets(),
        applied: hermesFeaturesService.store.getAppliedPersonality(orgId, agentId),
      })
    }
    if (section === 'plugins') {
      return apiSuccess({ plugins: hermesFeaturesService.listPlugins(orgId) })
    }
    if (section === 'media') {
      return apiSuccess({
        media: hermesFeaturesService.assessMediaReadiness({
          sttConfigured: url.searchParams.get('stt') === '1',
          ttsProvider: url.searchParams.get('tts'),
          browserBackend: (url.searchParams.get('browser') as 'cdp' | null) || null,
          visionModel: url.searchParams.get('vision'),
          imageGenProvider: url.searchParams.get('imageGen'),
        }),
      })
    }
    if (section === 'checkpoints' && conversationId) {
      return apiSuccess({
        checkpoints: hermesFeaturesService.listCheckpoints(orgId, conversationId),
      })
    }
    if (section === 'batch') {
      return apiSuccess({ batchJobs: hermesFeaturesService.listBatch(orgId) })
    }

    return apiSuccess({
      architecture: 'firestore+/v1/runs',
      snapshot: hermesFeaturesService.store.snapshot(orgId),
      toolsets: hermesFeaturesService.getToolsets(orgId, agentId, conversationId),
      memory: hermesFeaturesService.getMemory(orgId, agentId),
      skills: hermesFeaturesService.listSkills(orgId, agentId),
      media: hermesFeaturesService.assessMediaReadiness(),
      personality: hermesFeaturesService.listPersonalityPresets(),
      deferred: ['wake_word', 'discord_voice', 'skins', 'public_openai_api_product', 'acp_ide', 'sharegpt_batch_export'],
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 400)
  }
})

export const POST = withAuth('admin', async (req: NextRequest) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const action = String(body.action || '')
  const orgId = String(body.orgId || 'pib')
  const agentId = String(body.agentId || 'pip')
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined

  try {
    switch (action) {
      case 'toolsets.enable':
        return apiSuccess({
          toolsets: hermesFeaturesService.enableToolset(orgId, agentId, String(body.toolset || ''), conversationId),
        })
      case 'toolsets.disable':
        return apiSuccess({
          toolsets: hermesFeaturesService.disableToolset(orgId, agentId, String(body.toolset || ''), conversationId),
        })
      case 'toolsets.set':
        return apiSuccess({
          toolsets: hermesFeaturesService.setToolsets(
            orgId,
            agentId,
            Array.isArray(body.toolsets) ? body.toolsets.map(String) : [],
            conversationId,
          ),
        })
      case 'skills.catalog':
        return apiSuccess({
          skills: hermesFeaturesService.setSkillCatalog(
            orgId,
            agentId,
            Array.isArray(body.docs) ? (body.docs as Array<{ id: string; name: string; description: string; body?: string }>) : [],
          ),
        })
      case 'skills.select':
        return apiSuccess({
          skills: hermesFeaturesService.selectAndLoadSkills(
            orgId,
            agentId,
            String(body.query || ''),
            (body.bodies as Record<string, string>) || {},
          ),
        })
      case 'memory.set':
        return apiSuccess({
          memory: hermesFeaturesService.setMemorySection(
            orgId,
            agentId,
            body.section === 'user' ? 'user' : 'memory',
            String(body.content || ''),
          ),
        })
      case 'memory.append':
        return apiSuccess({
          memory: hermesFeaturesService.appendMemory(
            orgId,
            agentId,
            body.section === 'user' ? 'user' : 'memory',
            String(body.bullet || ''),
          ),
        })
      case 'context.discover':
        return apiSuccess({
          files: hermesFeaturesService.discoverContextFiles((body.files as Record<string, string>) || {}),
        })
      case 'context.expand':
        return apiSuccess({
          expansion: hermesFeaturesService.expandContextReference(
            {
              kind: body.kind as 'file' | 'folder' | 'diff' | 'url',
              query: String(body.query || ''),
            },
            (body.deps as Parameters<typeof hermesFeaturesService.expandContextReference>[1]) || {},
          ),
        })
      case 'checkpoint.create': {
        const snap = hermesFeaturesService.createCheckpoint({
          orgId,
          conversationId: conversationId || 'unknown',
          files: (body.files as Record<string, string>) || {},
          label: typeof body.label === 'string' ? body.label : undefined,
        })
        return apiSuccess({ checkpoint: snap })
      }
      case 'checkpoint.rollback': {
        const result = hermesFeaturesService.rollback(
          orgId,
          conversationId || 'unknown',
          typeof body.checkpointId === 'string' ? body.checkpointId : undefined,
        )
        return apiSuccess(result)
      }
      case 'cron.create':
        return apiSuccess({
          job: hermesFeaturesService.createCron({
            orgId,
            agentId,
            name: String(body.name || ''),
            schedule: String(body.schedule || ''),
            prompt: String(body.prompt || ''),
            skillIds: Array.isArray(body.skillIds) ? body.skillIds.map(String) : undefined,
          }),
        })
      case 'cron.pause':
        return apiSuccess({ job: hermesFeaturesService.pauseCron(orgId, String(body.id || '')) })
      case 'cron.resume':
        return apiSuccess({ job: hermesFeaturesService.resumeCron(orgId, String(body.id || '')) })
      case 'cron.edit':
        return apiSuccess({
          job: hermesFeaturesService.editCron(orgId, String(body.id || ''), {
            name: typeof body.name === 'string' ? body.name : undefined,
            schedule: typeof body.schedule === 'string' ? body.schedule : undefined,
            prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
          }),
        })
      case 'delegation.spawn':
        return apiSuccess({
          spawn: hermesFeaturesService.spawnDelegations({
            parentRunHint: String(body.parentRunHint || 'api'),
            goals: Array.isArray(body.goals) ? body.goals.map(String) : [],
            maxConcurrent: typeof body.maxConcurrent === 'number' ? body.maxConcurrent : undefined,
          }),
        })
      case 'code.execute':
        return apiSuccess({
          result: hermesFeaturesService.executeCode(orgId, agentId, String(body.script || ''), conversationId),
        })
      case 'hooks.create':
        return apiSuccess({
          hook: hermesFeaturesService.createHook({
            orgId,
            kind: String(body.kind || ''),
            name: String(body.name || ''),
            config: (body.config as Record<string, string>) || {},
          }),
        })
      case 'hooks.setEnabled':
        return apiSuccess({
          hook: hermesFeaturesService.setHookEnabled(orgId, String(body.id || ''), body.enabled !== false),
        })
      case 'batch.run':
        return apiSuccess({
          job: hermesFeaturesService.runBatch({
            orgId,
            agentId,
            prompts: Array.isArray(body.prompts) ? body.prompts.map(String) : [],
          }),
        })
      case 'mcp.register':
        return apiSuccess({
          server: hermesFeaturesService.registerMcp({
            orgId,
            name: String(body.name || ''),
            transport: String(body.transport || ''),
            endpoint: String(body.endpoint || ''),
            toolAllowlist: Array.isArray(body.toolAllowlist) ? body.toolAllowlist.map(String) : undefined,
            toolDenylist: Array.isArray(body.toolDenylist) ? body.toolDenylist.map(String) : undefined,
          }),
        })
      case 'routing.set':
        return apiSuccess({
          routing: hermesFeaturesService.setRouting(orgId, {
            orgId,
            sort: body.sort as 'cost' | 'speed' | 'quality' | 'priority' | undefined,
            allowlist: Array.isArray(body.allowlist) ? body.allowlist.map(String) : undefined,
            denylist: Array.isArray(body.denylist) ? body.denylist.map(String) : undefined,
            priority: Array.isArray(body.priority) ? body.priority.map(String) : undefined,
          }),
        })
      case 'routing.apply':
        return apiSuccess({
          ordered: hermesFeaturesService.applyRouting(
            hermesFeaturesService.getRouting(orgId),
            Array.isArray(body.candidates) ? body.candidates.map(String) : [],
          ),
        })
      case 'credentials.upsert':
        return apiSuccess({
          pool: hermesFeaturesService.upsertCredentialPool({
            orgId,
            provider: String(body.provider || ''),
            keys: Array.isArray(body.keys)
              ? (body.keys as Array<{ id: string; label: string; fingerprint: string; priority?: number }>)
              : [],
          }),
        })
      case 'credentials.select': {
        const pool = hermesFeaturesService.listCredentialPools(orgId).find((p) => p.provider === String(body.provider || ''))
        if (!pool) return apiError('Credential pool not found', 404)
        return apiSuccess({
          key: hermesFeaturesService.selectCredentialKey(pool, {
            forceRotateFrom: typeof body.forceRotateFrom === 'string' ? body.forceRotateFrom : undefined,
          }),
        })
      }
      case 'memoryProvider.bind':
        return apiSuccess({
          binding: hermesFeaturesService.bindMemoryProvider({
            orgId,
            agentId,
            provider: String(body.provider || ''),
            config: (body.config as Record<string, string>) || {},
          }),
        })
      case 'memoryProvider.lookup': {
        const binding = hermesFeaturesService.listMemoryProviders(orgId, agentId)[0]
        if (!binding) return apiError('No memory provider binding', 404)
        return apiSuccess({
          result: hermesFeaturesService.externalMemoryLookup(binding, String(body.query || '')),
        })
      }
      case 'personality.apply':
        return apiSuccess({
          preset: hermesFeaturesService.applyPersonality(orgId, agentId, String(body.presetId || '')),
        })
      case 'plugins.install':
        return apiSuccess({ plugins: hermesFeaturesService.installPlugin(orgId, String(body.pluginId || '')) })
      case 'dispatch.build':
        return apiSuccess({
          dispatch: hermesFeaturesService.buildDispatchBlock({
            orgId,
            agentId,
            conversationId,
            userMessage: String(body.userMessage || ''),
            workspaceFiles: (body.workspaceFiles as Record<string, string>) || undefined,
            skillBodies: (body.skillBodies as Record<string, string>) || undefined,
          }),
        })
      case 'media.speak':
        return apiSuccess({
          speak: hermesFeaturesService.hermesSpeakPath(
            typeof body.provider === 'string' ? body.provider : null,
            String(body.text || ''),
          ),
        })
      case 'browser.contract':
        return apiSuccess({
          contract: hermesFeaturesService.browserNavigateExtractContract({
            url: String(body.url || ''),
            backend: typeof body.backend === 'string' ? body.backend : null,
          }),
        })
      default:
        return apiError(`Unknown action: ${action}`, 400)
    }
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 400)
  }
})
