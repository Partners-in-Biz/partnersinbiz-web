/**
 * Assemble Hermes feature blocks injected into Messages `/v1/runs` prompts.
 * Architecture: Firestore + /v1/runs — not SessionDB slash.exec.
 */
import { hermesFeaturesStore } from './store'
import { toolsetDispatchBlock } from './toolsets'
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
import { isToolsetEnabled } from './toolsets'

export interface HermesFeaturesDispatchInput {
  orgId: string
  agentId: string
  conversationId?: string
  userMessage: string
  workspaceFiles?: Record<string, string>
  refDeps?: ContextRefExpandDeps
  /** Optional skill body map id → body for progressive load. */
  skillBodies?: Record<string, string>
}

export interface HermesFeaturesDispatchResult {
  block: string
  expansionsCount: number
  enabledToolsets: string[]
  loadedSkillIds: string[]
}

export function buildHermesFeaturesDispatchBlock(
  input: HermesFeaturesDispatchInput,
): HermesFeaturesDispatchResult {
  const store = hermesFeaturesStore
  const policy = store.getToolsetPolicy(input.orgId, input.agentId, input.conversationId)
  const memory = store.getMemory(input.orgId, input.agentId)
  let catalog = store.getSkills(input.orgId, input.agentId)

  // Progressive selection: pick top skills for this message and load bodies when available.
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
    store.setSkills(input.orgId, input.agentId, catalog)
  }

  const workspaceFiles =
    input.workspaceFiles ||
    (input.conversationId
      ? store.getWorkspaceFiles(input.orgId, input.conversationId)
      : {})
  const contextFiles = discoverContextFilesFromMap(workspaceFiles)

  const { text: _rewritten, expansions } = expandAtTokensInMessage(
    input.userMessage,
    input.refDeps || {
      readFile: (path) => workspaceFiles[path] ?? null,
      listFolder: (path) => {
        const prefix = path.endsWith('/') ? path : `${path}/`
        const names = Object.keys(workspaceFiles)
          .filter((p) => p === path || p.startsWith(prefix))
          .map((p) => p.slice(prefix.length === path.length + 1 ? prefix.length : 0) || p)
        return names.length ? names : null
      },
    },
  )

  const personalityId = store.getAppliedPersonality(input.orgId, input.agentId)
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
    '[PiB architecture note]',
    'Messages dispatches via Firestore + /v1/runs (not Hermes SessionDB/slash.exec).',
    '',
  ]

  return {
    block: parts.filter(Boolean).join('\n'),
    expansionsCount: expansions.length,
    enabledToolsets: [...policy.enabled],
    loadedSkillIds: loadedIds,
  }
}
