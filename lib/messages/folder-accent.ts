/** Distinct left-rail accents for Cowork folders / projects and matching chat tabs. */
const FOLDER_ACCENT_PALETTE = [
  '#f87171', // red
  '#fb923c', // orange
  '#fbbf24', // amber
  '#a3e635', // lime
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#818cf8', // indigo
  '#a78bfa', // violet
  '#f472b6', // pink
] as const

export function folderAccentColor(seed: string): string {
  const normalized = seed.trim().toLowerCase()
  if (!normalized) return FOLDER_ACCENT_PALETTE[0]
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0
  }
  return FOLDER_ACCENT_PALETTE[Math.abs(hash) % FOLDER_ACCENT_PALETTE.length]
}

type AccentConversation = {
  workspaceContext?: {
    companyId?: string | null
    projectId?: string | null
  } | null
  scope?: string
  scopeRefId?: string
  contextRefs?: Array<{ type: string; id: string }>
}

/** Stable seed shared by a Cowork folder/project and its open conversation tabs. */
export function conversationFolderAccentSeed(conversation: AccentConversation): string | null {
  const projectId = conversation.workspaceContext?.projectId?.trim()
    || (conversation.scope === 'project' ? conversation.scopeRefId?.trim() : '')
    || conversation.contextRefs?.find((ref) => ref.type === 'project')?.id?.trim()
  if (projectId) return `project:${projectId}`

  const companyId = conversation.workspaceContext?.companyId?.trim()
    || (conversation.scope === 'company' ? conversation.scopeRefId?.trim() : '')
    || conversation.contextRefs?.find((ref) => ref.type === 'company')?.id?.trim()
  if (companyId) return `company:${companyId}`

  return null
}

export function folderAccentStyle(seed: string | null | undefined): { ['--mx-folder-accent']?: string } {
  if (!seed) return {}
  return { '--mx-folder-accent': folderAccentColor(seed) }
}
