import type { CheckpointSnapshot } from './types'

function hashContent(content: string): string {
  // Simple stable non-crypto hash for snapshot ids (tests + small workspaces).
  let h = 2166136261
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function createCheckpoint(input: {
  orgId: string
  conversationId: string
  files: Record<string, string>
  label?: string
  createdBy?: string
  workspaceBindingId?: string
  id?: string
}): CheckpointSnapshot {
  const entries = Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))
  const material = entries.map(([path, content]) => `${path}:${hashContent(content)}`).join('|')
  const id = input.id || `chk_${hashContent(material + input.conversationId)}`
  return {
    id,
    orgId: input.orgId,
    conversationId: input.conversationId,
    ...(input.workspaceBindingId ? { workspaceBindingId: input.workspaceBindingId } : {}),
    label: input.label || `Checkpoint ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    files: Object.fromEntries(entries),
  }
}

export function restoreCheckpoint(
  currentFiles: Record<string, string>,
  snapshot: CheckpointSnapshot,
): { files: Record<string, string>; restoredPaths: string[]; removedPaths: string[] } {
  const files = { ...snapshot.files }
  const restoredPaths = Object.keys(snapshot.files)
  const removedPaths = Object.keys(currentFiles).filter((p) => !(p in snapshot.files))
  return { files, restoredPaths, removedPaths }
}

export function checkpointSummary(snapshot: CheckpointSnapshot): string {
  const count = Object.keys(snapshot.files).length
  return `Checkpoint ${snapshot.id} — ${count} file(s) — ${snapshot.label}`
}
