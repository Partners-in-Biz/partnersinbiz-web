/**
 * Messages slash handlers for Hermes features control plane (async durable store).
 */
import { hermesFeaturesService } from './service'
import { ALL_HERMES_TOOLSETS } from './types'
import { listPersonalityPresets } from './personality'
import {
  createNodeWorkspaceFs,
  resolveWorkspaceRootFromConversation,
} from './workspace-fs'

export interface HermesFeaturesSlashResult {
  handled: boolean
  reply: string
  shouldDispatch: boolean
  data?: unknown
}

function parseArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean)
}

export async function handleToolsetsSlash(input: {
  orgId: string
  agentId: string
  conversationId?: string
  args: string
}): Promise<HermesFeaturesSlashResult> {
  const parts = parseArgs(input.args)
  const sub = (parts[0] || 'list').toLowerCase()

  if (sub === 'list' || sub === 'show' || !parts[0]) {
    const policy = await hermesFeaturesService.getToolsets(input.orgId, input.agentId, input.conversationId)
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        '**Hermes toolsets** (durable)',
        `Agent: \`${policy.agentId}\``,
        `Enabled: ${policy.enabled.join(', ') || '(none)'}`,
        `All: ${ALL_HERMES_TOOLSETS.join(', ')}`,
        '',
        'Usage: `/toolsets enable browser` · `/toolsets disable code_execution` · `/toolsets set terminal,web,file`',
      ].join('\n'),
      data: policy,
    }
  }

  if (sub === 'enable' && parts[1]) {
    const policy = await hermesFeaturesService.enableToolset(
      input.orgId,
      input.agentId,
      parts[1],
      input.conversationId,
    )
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Enabled toolset \`${parts[1]}\`. Now: ${policy.enabled.join(', ')}`,
      data: policy,
    }
  }

  if (sub === 'disable' && parts[1]) {
    const policy = await hermesFeaturesService.disableToolset(
      input.orgId,
      input.agentId,
      parts[1],
      input.conversationId,
    )
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Disabled toolset \`${parts[1]}\`. Now: ${policy.enabled.join(', ') || '(none)'}`,
      data: policy,
    }
  }

  if (sub === 'set' && parts[1]) {
    const list = parts.slice(1).join(' ').split(/[,\s]+/).filter(Boolean)
    const policy = await hermesFeaturesService.setToolsets(
      input.orgId,
      input.agentId,
      list,
      input.conversationId,
    )
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Toolsets set: ${policy.enabled.join(', ') || '(none)'}`,
      data: policy,
    }
  }

  return {
    handled: true,
    shouldDispatch: false,
    reply: 'Usage: `/toolsets` · `/toolsets enable <id>` · `/toolsets disable <id>` · `/toolsets set a,b,c`',
  }
}

export async function handleMemorySlash(input: {
  orgId: string
  agentId: string
  args: string
  uid?: string
}): Promise<HermesFeaturesSlashResult> {
  const trimmed = input.args.trim()
  if (!trimmed || trimmed === 'show' || trimmed === 'list') {
    const doc = await hermesFeaturesService.getMemory(input.orgId, input.agentId)
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        '**Curated memory (MEMORY.md / USER.md)** — durable cross-session',
        '',
        '### MEMORY.md',
        doc.memoryMd || '(empty)',
        '',
        '### USER.md',
        doc.userMd || '(empty)',
        '',
        'Usage: `/memory add <bullet>` · `/memory user add <bullet>` · `/memory set <text>`',
      ].join('\n'),
      data: doc,
    }
  }

  if (trimmed.startsWith('user add ')) {
    const bullet = trimmed.slice('user add '.length)
    const doc = await hermesFeaturesService.appendMemory(input.orgId, input.agentId, 'user', bullet, input.uid)
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Appended to USER.md (durable).\n\n${doc.userMd}`,
      data: doc,
    }
  }

  if (trimmed.startsWith('add ')) {
    const bullet = trimmed.slice(4)
    const doc = await hermesFeaturesService.appendMemory(input.orgId, input.agentId, 'memory', bullet, input.uid)
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Appended to MEMORY.md (durable).\n\n${doc.memoryMd}`,
      data: doc,
    }
  }

  if (trimmed.startsWith('set ')) {
    const content = trimmed.slice(4)
    const doc = await hermesFeaturesService.setMemorySection(
      input.orgId,
      input.agentId,
      'memory',
      content.startsWith('#') ? content : `# MEMORY\n\n${content}\n`,
      input.uid,
    )
    return {
      handled: true,
      shouldDispatch: false,
      reply: `MEMORY.md updated (${doc.memoryMd.length} chars, durable).`,
      data: doc,
    }
  }

  return {
    handled: true,
    shouldDispatch: false,
    reply: 'Usage: `/memory` · `/memory add <bullet>` · `/memory user add <bullet>` · `/memory set <text>`',
  }
}

export async function handleRollbackSlash(input: {
  orgId: string
  conversationId: string
  args: string
  workspaceContext?: {
    vpsWorkingPath?: string | null
    localWorkingPath?: string | null
    vpsPath?: string | null
    localPath?: string | null
  } | null
}): Promise<HermesFeaturesSlashResult> {
  const parts = parseArgs(input.args)
  const sub = (parts[0] || 'latest').toLowerCase()
  const root = resolveWorkspaceRootFromConversation(input.workspaceContext)
  const workspace = root ? createNodeWorkspaceFs(root) : undefined

  if (sub === 'list') {
    const list = await hermesFeaturesService.listCheckpoints(input.orgId, input.conversationId)
    if (list.length === 0) {
      return {
        handled: true,
        shouldDispatch: false,
        reply: 'No checkpoints. Use `/rollback checkpoint` (snapshots workspace when a local path is bound) or auto-checkpoint runs on dispatch when files exist.',
      }
    }
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        '**Checkpoints**',
        ...list.map((c) => `- \`${c.id}\` — ${c.label} (${Object.keys(c.files).length} files)`),
        '',
        'Restore: `/rollback` or `/rollback <checkpointId>`',
      ].join('\n'),
      data: list,
    }
  }

  if (sub === 'checkpoint' || sub === 'save') {
    const snap = await hermesFeaturesService.createCheckpoint({
      orgId: input.orgId,
      conversationId: input.conversationId,
      workspace: workspace || undefined,
      files: workspace ? undefined : { 'workspace/.keep': '' },
      label: parts.slice(1).join(' ') || undefined,
    })
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Created ${hermesFeaturesService.checkpointSummary(snap)}${workspace ? ` from ${workspace.root}` : ' (store overlay only — no local workspace path)'}`,
      data: snap,
    }
  }

  try {
    const id = sub === 'latest' || sub === 'now' ? undefined : parts[0]
    const result = await hermesFeaturesService.rollback({
      orgId: input.orgId,
      conversationId: input.conversationId,
      checkpointId: id,
      workspace: workspace || undefined,
    })
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        `Restored ${result.summary}`,
        workspace ? `Wrote files under ${workspace.root}` : 'Updated durable workspace overlay (no local path bound)',
        `Paths restored: ${result.restoredPaths.join(', ') || '(none)'}`,
        result.removedPaths.length ? `Paths removed: ${result.removedPaths.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      data: result,
    }
  } catch (err) {
    return {
      handled: true,
      shouldDispatch: false,
      reply: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function handlePersonalitySlash(input: {
  orgId: string
  agentId: string
  args: string
}): Promise<HermesFeaturesSlashResult> {
  const parts = parseArgs(input.args)
  const sub = (parts[0] || 'list').toLowerCase()

  if (sub === 'list' || !parts[0]) {
    const presets = listPersonalityPresets()
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        '**Personality presets**',
        ...presets.map((p) => `- \`${p.id}\` — ${p.name}: ${p.description}`),
        '',
        'Apply: `/personality apply engineer`',
      ].join('\n'),
      data: presets,
    }
  }

  if ((sub === 'apply' || sub === 'set') && parts[1]) {
    try {
      const preset = await hermesFeaturesService.applyPersonality(input.orgId, input.agentId, parts[1])
      return {
        handled: true,
        shouldDispatch: false,
        reply: `Applied personality \`${preset.id}\` (${preset.name}) for agent \`${input.agentId}\` (durable).`,
        data: preset,
      }
    } catch (err) {
      return {
        handled: true,
        shouldDispatch: false,
        reply: err instanceof Error ? err.message : String(err),
      }
    }
  }

  return {
    handled: true,
    shouldDispatch: false,
    reply: 'Usage: `/personality` · `/personality apply <presetId>`',
  }
}

export async function handleHermesFeaturesSlash(input: {
  orgId: string
  agentId: string
  args: string
}): Promise<HermesFeaturesSlashResult> {
  const media = hermesFeaturesService.assessMediaReadiness()
  const toolsets = await hermesFeaturesService.getToolsets(input.orgId, input.agentId)
  const plugins = await hermesFeaturesService.listPlugins(input.orgId)
  const mcp = await hermesFeaturesService.listMcp(input.orgId)
  return {
    handled: true,
    shouldDispatch: false,
    reply: [
      '**Hermes Features Overview — PiB control plane**',
      '',
      `Toolsets enabled: ${toolsets.enabled.join(', ')}`,
      `MCP servers (durable config): ${mcp.length}`,
      `Plugins installed flags: ${plugins.filter((p) => p.installed).length}/${plugins.length}`,
      '',
      'Media readiness (env-backed, not claimed complete without config):',
      ...media.map((m) => `- ${m.capability}: **${m.status}**${m.provider ? ` (${m.provider})` : ''}`),
      '',
      'Architecture: Firestore `hermes_features` + Messages `/v1/runs`.',
      'Partial: code-exec sandbox, batch echo unless runner injected, media/MCP need runtime env.',
      'Deferred: wake-word, Discord voice, skins, public OpenAI API product, ACP/IDE, ShareGPT export.',
    ].join('\n'),
    data: { toolsets, media, plugins, mcp },
  }
}

export async function tryHandleHermesFeaturesSlash(input: {
  token: string
  args: string
  orgId: string
  agentId: string
  conversationId: string
  uid?: string
  workspaceContext?: {
    vpsWorkingPath?: string | null
    localWorkingPath?: string | null
    vpsPath?: string | null
    localPath?: string | null
  } | null
}): Promise<HermesFeaturesSlashResult | null> {
  const token = input.token.toLowerCase()
  if (token === '/toolsets' || token === '/toolset') {
    return handleToolsetsSlash(input)
  }
  if (token === '/memory') {
    return handleMemorySlash(input)
  }
  if (token === '/rollback' || token === '/checkpoint') {
    return handleRollbackSlash(input)
  }
  if (token === '/personality' || token === '/soul') {
    return handlePersonalitySlash(input)
  }
  if (token === '/hermes-features' || token === '/hermes-features-status') {
    return handleHermesFeaturesSlash(input)
  }
  return null
}
