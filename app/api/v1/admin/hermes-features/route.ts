/**
 * GET/POST /api/v1/admin/hermes-features
 * Durable control plane for Hermes Features Overview productization in PiB.
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
      return apiSuccess({ toolsets: await hermesFeaturesService.getToolsets(orgId, agentId, conversationId) })
    }
    if (section === 'skills') {
      return apiSuccess({ skills: await hermesFeaturesService.listSkills(orgId, agentId) })
    }
    if (section === 'memory') {
      return apiSuccess({ memory: await hermesFeaturesService.getMemory(orgId, agentId) })
    }
    if (section === 'cron') {
      return apiSuccess({ cronJobs: await hermesFeaturesService.listCron(orgId) })
    }
    if (section === 'hooks') {
      return apiSuccess({ hooks: await hermesFeaturesService.listHooks(orgId), kinds: hermesFeaturesService.listHookKinds() })
    }
    if (section === 'mcp') {
      return apiSuccess({ mcpServers: await hermesFeaturesService.listMcp(orgId) })
    }
    if (section === 'routing') {
      return apiSuccess({ routing: await hermesFeaturesService.getRouting(orgId) })
    }
    if (section === 'credential-pools') {
      return apiSuccess({ pools: await hermesFeaturesService.listCredentialPools(orgId) })
    }
    if (section === 'memory-providers') {
      return apiSuccess({ providers: await hermesFeaturesService.listMemoryProviders(orgId, agentId) })
    }
    if (section === 'personality') {
      return apiSuccess({
        presets: hermesFeaturesService.listPersonalityPresets(),
        applied: await hermesFeaturesService.getAppliedPersonality(orgId, agentId),
      })
    }
    if (section === 'plugins') {
      return apiSuccess({ plugins: await hermesFeaturesService.listPlugins(orgId) })
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
        checkpoints: await hermesFeaturesService.listCheckpoints(orgId, conversationId),
      })
    }
    if (section === 'batch') {
      return apiSuccess({ batchJobs: await hermesFeaturesService.listBatch(orgId) })
    }
    if (section === 'delegations') {
      return apiSuccess({
        delegations: await hermesFeaturesService.repository.listDelegations(orgId, conversationId),
      })
    }

    return apiSuccess({
      architecture: 'firestore_hermes_features+/v1/runs',
      toolsets: await hermesFeaturesService.getToolsets(orgId, agentId, conversationId),
      memory: await hermesFeaturesService.getMemory(orgId, agentId),
      skills: await hermesFeaturesService.listSkills(orgId, agentId),
      media: hermesFeaturesService.assessMediaReadiness(),
      personality: hermesFeaturesService.listPersonalityPresets(),
      deferred: ['wake_word', 'discord_voice', 'skins', 'public_openai_api_product', 'acp_ide', 'sharegpt_batch_export'],
      partial: ['code_execution_sandbox', 'batch_without_runner', 'mcp_profile_sync', 'media_without_env'],
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
          toolsets: await hermesFeaturesService.enableToolset(orgId, agentId, String(body.toolset || ''), conversationId),
        })
      case 'toolsets.disable':
        return apiSuccess({
          toolsets: await hermesFeaturesService.disableToolset(orgId, agentId, String(body.toolset || ''), conversationId),
        })
      case 'toolsets.set':
        return apiSuccess({
          toolsets: await hermesFeaturesService.setToolsets(
            orgId,
            agentId,
            Array.isArray(body.toolsets) ? body.toolsets.map(String) : [],
            conversationId,
          ),
        })
      case 'skills.catalog':
        return apiSuccess({
          skills: await hermesFeaturesService.setSkillCatalog(
            orgId,
            agentId,
            Array.isArray(body.docs) ? (body.docs as Array<{ id: string; name: string; description: string; body?: string }>) : [],
          ),
        })
      case 'skills.select':
        return apiSuccess({
          skills: await hermesFeaturesService.selectAndLoadSkills(
            orgId,
            agentId,
            String(body.query || ''),
            (body.bodies as Record<string, string>) || {},
          ),
        })
      case 'memory.set':
        return apiSuccess({
          memory: await hermesFeaturesService.setMemorySection(
            orgId,
            agentId,
            body.section === 'user' ? 'user' : 'memory',
            String(body.content || ''),
          ),
        })
      case 'memory.append':
        return apiSuccess({
          memory: await hermesFeaturesService.appendMemory(
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
        const snap = await hermesFeaturesService.createCheckpoint({
          orgId,
          conversationId: conversationId || 'unknown',
          files: (body.files as Record<string, string>) || {},
          label: typeof body.label === 'string' ? body.label : undefined,
        })
        return apiSuccess({ checkpoint: snap })
      }
      case 'checkpoint.rollback': {
        const result = await hermesFeaturesService.rollback({
          orgId,
          conversationId: conversationId || 'unknown',
          checkpointId: typeof body.checkpointId === 'string' ? body.checkpointId : undefined,
        })
        return apiSuccess(result)
      }
      case 'cron.create':
        return apiSuccess({
          job: await hermesFeaturesService.createCron({
            orgId,
            agentId,
            name: String(body.name || ''),
            schedule: String(body.schedule || ''),
            prompt: String(body.prompt || ''),
            skillIds: Array.isArray(body.skillIds) ? body.skillIds.map(String) : undefined,
          }),
        })
      case 'cron.pause':
        return apiSuccess({ job: await hermesFeaturesService.pauseCron(orgId, String(body.id || '')) })
      case 'cron.resume':
        return apiSuccess({ job: await hermesFeaturesService.resumeCron(orgId, String(body.id || '')) })
      case 'cron.edit':
        return apiSuccess({
          job: await hermesFeaturesService.editCron(orgId, String(body.id || ''), {
            name: typeof body.name === 'string' ? body.name : undefined,
            schedule: typeof body.schedule === 'string' ? body.schedule : undefined,
            prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
          }),
        })
      case 'cron.fire':
        return apiSuccess({ job: await hermesFeaturesService.fireCron(orgId, String(body.id || '')) })
      case 'cron.processDue':
        return apiSuccess({ fired: await hermesFeaturesService.processDueCron(orgId) })
      case 'delegation.spawn':
        return apiSuccess({
          spawn: await hermesFeaturesService.spawnObservableDelegations({
            orgId,
            agentId,
            conversationId,
            parentRunHint: String(body.parentRunHint || 'api'),
            goals: Array.isArray(body.goals) ? body.goals.map(String) : [],
            maxConcurrent: typeof body.maxConcurrent === 'number' ? body.maxConcurrent : undefined,
          }),
        })
      case 'delegation.observe':
        return apiSuccess({
          delegation: await hermesFeaturesService.observeDelegation(orgId, String(body.id || '')),
        })
      case 'code.execute':
        return apiSuccess({
          result: await hermesFeaturesService.executeCode(orgId, agentId, String(body.script || ''), conversationId),
        })
      case 'hooks.create':
        return apiSuccess({
          hook: await hermesFeaturesService.createHook({
            orgId,
            kind: String(body.kind || ''),
            name: String(body.name || ''),
            config: (body.config as Record<string, string>) || {},
          }),
        })
      case 'hooks.setEnabled':
        return apiSuccess({
          hook: await hermesFeaturesService.setHookEnabled(orgId, String(body.id || ''), body.enabled !== false),
        })
      case 'batch.run':
        return apiSuccess({
          job: await hermesFeaturesService.runBatch({
            orgId,
            agentId,
            prompts: Array.isArray(body.prompts) ? body.prompts.map(String) : [],
          }),
        })
      case 'mcp.register':
        return apiSuccess({
          server: await hermesFeaturesService.registerMcp({
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
          routing: await hermesFeaturesService.setRouting(orgId, {
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
            await hermesFeaturesService.getRouting(orgId),
            Array.isArray(body.candidates) ? body.candidates.map(String) : [],
          ),
        })
      case 'credentials.upsert':
        return apiSuccess({
          pool: await hermesFeaturesService.upsertCredentialPool({
            orgId,
            provider: String(body.provider || ''),
            keys: Array.isArray(body.keys)
              ? (body.keys as Array<{ id: string; label: string; fingerprint: string; priority?: number }>)
              : [],
          }),
        })
      case 'credentials.select': {
        const pool = (await hermesFeaturesService.listCredentialPools(orgId)).find((p) => p.provider === String(body.provider || ''))
        if (!pool) return apiError('Credential pool not found', 404)
        return apiSuccess({
          key: hermesFeaturesService.selectCredentialKey(pool, {
            forceRotateFrom: typeof body.forceRotateFrom === 'string' ? body.forceRotateFrom : undefined,
          }),
        })
      }
      case 'memoryProvider.bind':
        return apiSuccess({
          binding: await hermesFeaturesService.bindMemoryProvider({
            orgId,
            agentId,
            provider: String(body.provider || ''),
            config: (body.config as Record<string, string>) || {},
          }),
        })
      case 'memoryProvider.lookup': {
        const binding = (await hermesFeaturesService.listMemoryProviders(orgId, agentId))[0]
        if (!binding) return apiError('No memory provider binding', 404)
        return apiSuccess({
          result: await hermesFeaturesService.externalMemoryLookup(binding, String(body.query || '')),
        })
      }
      case 'personality.apply':
        return apiSuccess({
          preset: await hermesFeaturesService.applyPersonality(orgId, agentId, String(body.presetId || '')),
        })
      case 'plugins.install':
        return apiSuccess({ plugins: await hermesFeaturesService.installPlugin(orgId, String(body.pluginId || '')) })
      case 'dispatch.build':
        return apiSuccess({
          dispatch: await hermesFeaturesService.buildDispatchBlock({
            orgId,
            agentId,
            conversationId,
            userMessage: String(body.userMessage || ''),
            workspaceFiles: (body.workspaceFiles as Record<string, string>) || undefined,
            skillBodies: (body.skillBodies as Record<string, string>) || undefined,
            autoCheckpoint: body.autoCheckpoint === true,
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
