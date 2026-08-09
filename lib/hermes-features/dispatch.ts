/**
 * Assemble Hermes feature blocks injected into Messages `/v1/runs` prompts.
 * Architecture: Firestore + /v1/runs — not SessionDB slash.exec.
 */
import { getHermesFeaturesRepository } from './repository'
import { toolsetDispatchBlock, isToolsetEnabled } from './toolsets'
import {
  progressiveSkillsDispatchBlock,
} from './skills-progressive'
import { memoryDispatchBlock } from './memory-curated'
import {
  contextFilesDispatchBlock,
  discoverContextFilesFromMap,
  selectContextFilesForPrompt,
} from './context-files'
import {
  expandAtTokensInMessage,
  contextRefsDispatchBlock,
  type ContextRefExpandDeps,
} from './context-refs-expand'
import { getPersonalityPreset, personalityDispatchBlock } from './personality'
import type { WorkspaceFs } from './workspace-fs'
import type { DiscoveredContextFile, ProgressiveSkillMeta } from './types'
import { buildDefaultRefDeps } from './ref-deps'

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

  // Skill bodies are intentionally never inferred from user wording. The runtime's
  // scoped skill_view tool performs explicit, allowlisted body retrieval on demand.
  const loadedIds: string[] = []

  let contextFiles: DiscoveredContextFile[] = []
  let workspaceFiles: Record<string, string> = {}

  if (input.workspace) {
    // Root instructions are read lazily. A full workspace snapshot is only needed
    // for a requested checkpoint/write-capable run, never ordinary chat.
    contextFiles = selectContextFilesForPrompt(input.workspace.discoverContextFiles())
    if (input.autoCheckpoint) {
      workspaceFiles = input.workspace.snapshotTextFiles()
      if (input.conversationId) {
        await store.setWorkspaceFiles(input.orgId, input.conversationId, workspaceFiles)
      }
    }
  } else {
    workspaceFiles =
      input.workspaceFiles ||
      (input.conversationId
        ? await store.getWorkspaceFiles(input.orgId, input.conversationId)
        : {})
    contextFiles = selectContextFilesForPrompt(discoverContextFilesFromMap(workspaceFiles))
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

  const refDeps: ContextRefExpandDeps = input.refDeps || buildDefaultRefDeps({
    workspace: input.workspace,
    workspaceFiles,
    cwd: input.workspace?.root || process.cwd(),
  })

  const { expansions } = expandAtTokensInMessage(input.userMessage, refDeps)

  const personalityId = await store.getAppliedPersonality(input.orgId, input.agentId)
  const personality = personalityId ? getPersonalityPreset(personalityId) : null

  const parts = [
    toolsetDispatchBlock(policy),
    isToolsetEnabled(policy, 'skills')
      ? progressiveSkillsDispatchBlock(catalog)
      : '[Hermes skills — on demand]\nskills toolset disabled\n',
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
