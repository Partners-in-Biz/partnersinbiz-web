/**
 * Assemble Hermes feature blocks injected into Messages `/v1/runs` prompts.
 * Architecture: Firestore + /v1/runs — not SessionDB slash.exec.
 */
import { getHermesFeaturesRepository } from './repository'
import { toolsetDispatchBlock, isToolsetEnabled } from './toolsets'
import {
  progressiveSkillsDispatchBlock,
  selectSkillsForRequest,
  loadSkillBody,
} from './skills-progressive'
import { memoryDispatchBlock } from './memory-curated'
import {
  contextFilesDispatchBlock,
  discoverContextFilesFromMap,
} from './context-files'
import {
  expandAtTokensInMessage,
  contextRefsDispatchBlock,
  type ContextRefExpandDeps,
} from './context-refs-expand'
import { getPersonalityPreset, personalityDispatchBlock } from './personality'
import type { WorkspaceFs } from './workspace-fs'
import type { DiscoveredContextFile, ProgressiveSkillMeta } from './types'

export interface HermesFeaturesDispatchInput {
  orgId: string
  agentId: string
  conversationId?: string
  userMessage: string
  workspaceFiles?: Record<string, string>
  workspace?: WorkspaceFs
  refDeps?: ContextRefExpandDeps
  /** Progressive load: skill id → body content (from disk/API). */
  skillBodies?: Record<string, string>
  /** Pre-built catalog metadata (optional; otherwise from durable store). */
  skillCatalog?: ProgressiveSkillMeta[]
  autoCheckpoint?: boolean
}

export interface HermesFeaturesDispatchResult {
  block: string
  expansionsCount: number
  enabledToolsets: string[]
  loadedSkillIds: string[]
  contextFileNames: string[]
  checkpointId?: string
}

export async function buildHermesFeaturesDispatchBlock(
  input: HermesFeaturesDispatchInput,
): Promise<HermesFeaturesDispatchResult> {
  const store = getHermesFeaturesRepository()
  const policy = await store.getToolsetPolicy(input.orgId, input.agentId, input.conversationId)
  const memory = await store.getMemory(input.orgId, input.agentId)
  let catalog = input.skillCatalog
    ? input.skillCatalog.map((s) => ({ ...s }))
    : await store.getSkills(input.orgId, input.agentId)

  const selected = selectSkillsForRequest(catalog, input.userMessage, 3)
  const loadedIds: string[] = []
  for (const skill of selected) {
    const body = input.skillBodies?.[skill.id]
    if (body) {
      catalog = loadSkillBody(catalog, skill.id, body)
      loadedIds.push(skill.id)
    }
  }
  if (loadedIds.length > 0) {
    await store.setSkills(input.orgId, input.agentId, catalog)
  }

  let contextFiles: DiscoveredContextFile[] = []
  let workspaceFiles: Record<string, string> = {}

  if (input.workspace) {
    contextFiles = input.workspace.discoverContextFiles()
    workspaceFiles = input.workspace.snapshotTextFiles()
    if (input.conversationId) {
      await store.setWorkspaceFiles(input.orgId, input.conversationId, workspaceFiles)
    }
  } else {
    workspaceFiles =
      input.workspaceFiles ||
      (input.conversationId
        ? await store.getWorkspaceFiles(input.orgId, input.conversationId)
        : {})
    contextFiles = discoverContextFilesFromMap(workspaceFiles)
  }

  let checkpointId: string | undefined
  if (input.autoCheckpoint && input.conversationId && Object.keys(workspaceFiles).length > 0) {
    const { createCheckpoint } = await import('./checkpoints')
    const snap = createCheckpoint({
      orgId: input.orgId,
      conversationId: input.conversationId,
      files: workspaceFiles,
      label: 'auto-before-dispatch',
    })
    await store.addCheckpoint(snap)
    checkpointId = snap.id
  }

  const refDeps: ContextRefExpandDeps = input.refDeps || {
    readFile: (p) => {
      if (input.workspace) return input.workspace.readFile(p)
      return workspaceFiles[p] ?? null
    },
    listFolder: (p) => {
      if (input.workspace) return input.workspace.listFolder(p)
      const prefix = p.endsWith('/') ? p : `${p}/`
      const names = Object.keys(workspaceFiles)
        .filter((key) => key === p || key.startsWith(prefix))
        .map((key) => (key.startsWith(prefix) ? key.slice(prefix.length).split('/')[0] : key))
        .filter(Boolean)
      return names.length ? [...new Set(names)] : null
    },
  }

  const { expansions } = expandAtTokensInMessage(input.userMessage, refDeps)

  const personalityId = await store.getAppliedPersonality(input.orgId, input.agentId)
  const personality = personalityId ? getPersonalityPreset(personalityId) : null

  const parts = [
    toolsetDispatchBlock(policy),
    isToolsetEnabled(policy, 'skills')
      ? progressiveSkillsDispatchBlock(catalog.filter((s) => s.loaded))
      : '[Hermes skills — progressive]\nskills toolset disabled\n',
    isToolsetEnabled(policy, 'memory')
      ? memoryDispatchBlock(memory)
      : '[Hermes curated memory]\nmemory toolset disabled\n',
    contextFilesDispatchBlock(contextFiles),
    contextRefsDispatchBlock(expansions),
    personality ? personalityDispatchBlock(personality) : '',
    checkpointId ? `[Checkpoint] auto snapshot ${checkpointId} taken before this run\n` : '',
    '[PiB architecture note]',
    'Messages dispatches via Firestore + /v1/runs (not Hermes SessionDB/slash.exec).',
    'Durable control-plane state is stored in hermes_features (Firestore) or memory test repository.',
    '',
  ]

  return {
    block: parts.filter(Boolean).join('\n'),
    expansionsCount: expansions.length,
    enabledToolsets: [...policy.enabled],
    loadedSkillIds: loadedIds,
    contextFileNames: contextFiles.map((f) => f.fileName),
    checkpointId,
  }
}
