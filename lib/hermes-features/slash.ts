/**
 * Messages slash handlers for Hermes features control plane.
 * Commands: /toolsets, /memory, /rollback, /personality, /hermes-features
 */
import { hermesFeaturesService } from './service'
import { ALL_HERMES_TOOLSETS } from './types'
import { listPersonalityPresets } from './personality'

export type HermesFeaturesSlashId =
  | 'toolsets'
  | 'memory'
  | 'rollback'
  | 'personality'
  | 'hermes-features'

export interface HermesFeaturesSlashResult {
  handled: boolean
  reply: string
  shouldDispatch: boolean
  data?: unknown
}

function parseArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean)
}

export function handleToolsetsSlash(input: {
  orgId: string
  agentId: string
  conversationId?: string
  args: string
}): HermesFeaturesSlashResult {
  const parts = parseArgs(input.args)
  const sub = (parts[0] || 'list').toLowerCase()

  if (sub === 'list' || sub === 'show' || !parts[0]) {
    const policy = hermesFeaturesService.getToolsets(input.orgId, input.agentId, input.conversationId)
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        '**Hermes toolsets**',
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
    const policy = hermesFeaturesService.enableToolset(
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
    const policy = hermesFeaturesService.disableToolset(
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
    const policy = hermesFeaturesService.setToolsets(
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

export function handleMemorySlash(input: {
  orgId: string
  agentId: string
  args: string
  uid?: string
}): HermesFeaturesSlashResult {
  const trimmed = input.args.trim()
  if (!trimmed || trimmed === 'show' || trimmed === 'list') {
    const doc = hermesFeaturesService.getMemory(input.orgId, input.agentId)
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        '**Curated memory (MEMORY.md / USER.md)**',
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
    const doc = hermesFeaturesService.appendMemory(input.orgId, input.agentId, 'user', bullet, input.uid)
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Appended to USER.md.\n\n${doc.userMd}`,
      data: doc,
    }
  }

  if (trimmed.startsWith('add ')) {
    const bullet = trimmed.slice(4)
    const doc = hermesFeaturesService.appendMemory(input.orgId, input.agentId, 'memory', bullet, input.uid)
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Appended to MEMORY.md.\n\n${doc.memoryMd}`,
      data: doc,
    }
  }

  if (trimmed.startsWith('set ')) {
    const content = trimmed.slice(4)
    const doc = hermesFeaturesService.setMemorySection(
      input.orgId,
      input.agentId,
      'memory',
      content.startsWith('#') ? content : `# MEMORY\n\n${content}\n`,
      input.uid,
    )
    return {
      handled: true,
      shouldDispatch: false,
      reply: `MEMORY.md updated (${doc.memoryMd.length} chars).`,
      data: doc,
    }
  }

  return {
    handled: true,
    shouldDispatch: false,
    reply: 'Usage: `/memory` · `/memory add <bullet>` · `/memory user add <bullet>` · `/memory set <text>`',
  }
}

export function handleRollbackSlash(input: {
  orgId: string
  conversationId: string
  args: string
}): HermesFeaturesSlashResult {
  const parts = parseArgs(input.args)
  const sub = (parts[0] || 'latest').toLowerCase()

  if (sub === 'list') {
    const list = hermesFeaturesService.listCheckpoints(input.orgId, input.conversationId)
    if (list.length === 0) {
      return {
        handled: true,
        shouldDispatch: false,
        reply: 'No checkpoints for this conversation. A checkpoint is created when you run `/rollback checkpoint` or before agent file mutations.',
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
    const files = hermesFeaturesService.store.getWorkspaceFiles(input.orgId, input.conversationId)
    const snap = hermesFeaturesService.createCheckpoint({
      orgId: input.orgId,
      conversationId: input.conversationId,
      files: Object.keys(files).length ? files : { 'workspace/.keep': '' },
      label: parts.slice(1).join(' ') || undefined,
    })
    return {
      handled: true,
      shouldDispatch: false,
      reply: `Created ${hermesFeaturesService.checkpointSummary(snap)}`,
      data: snap,
    }
  }

  try {
    const id = sub === 'latest' || sub === 'now' ? undefined : parts[0]
    const result = hermesFeaturesService.rollback(input.orgId, input.conversationId, id)
    return {
      handled: true,
      shouldDispatch: false,
      reply: [
        `Restored ${result.summary}`,
        `Paths restored: ${result.restoredPaths.join(', ') || '(none)'}`,
        result.removedPaths.length ? `Paths removed from workspace binding: ${result.removedPaths.join(', ')}` : '',
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

export function handlePersonalitySlash(input: {
  orgId: string
  agentId: string
  args: string
}): HermesFeaturesSlashResult {
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
      const preset = hermesFeaturesService.applyPersonality(input.orgId, input.agentId, parts[1])
      return {
        handled: true,
        shouldDispatch: false,
        reply: `Applied personality \`${preset.id}\` (${preset.name}) for agent \`${input.agentId}\`.`,
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

export function handleHermesFeaturesSlash(input: {
  orgId: string
  agentId: string
  args: string
}): HermesFeaturesSlashResult {
  const media = hermesFeaturesService.assessMediaReadiness()
  const toolsets = hermesFeaturesService.getToolsets(input.orgId, input.agentId)
  const plugins = hermesFeaturesService.listPlugins(input.orgId)
  const mcp = hermesFeaturesService.listMcp(input.orgId)
  return {
    handled: true,
    shouldDispatch: false,
    reply: [
      '**Hermes Features Overview — PiB control plane**',
      '',
      `Toolsets enabled: ${toolsets.enabled.join(', ')}`,
      `MCP servers: ${mcp.length}`,
      `Plugins installed: ${plugins.filter((p) => p.installed).length}/${plugins.length}`,
      '',
      'Media readiness:',
      ...media.map((m) => `- ${m.capability}: **${m.status}**${m.provider ? ` (${m.provider})` : ''}`),
      '',
      'Architecture: Firestore + `/v1/runs` (not SessionDB/`slash.exec`).',
      'Commands: `/toolsets` · `/memory` · `/rollback` · `/personality` · `/goal`',
      'Deferred: wake-word, Discord voice, skins, public OpenAI API product, ACP/IDE, ShareGPT batch export.',
    ].join('\n'),
    data: { toolsets, media, plugins, mcp },
  }
}

export function tryHandleHermesFeaturesSlash(input: {
  token: string
  args: string
  orgId: string
  agentId: string
  conversationId: string
  uid?: string
}): HermesFeaturesSlashResult | null {
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
