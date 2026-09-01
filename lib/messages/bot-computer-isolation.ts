/**
 * OpenBot-style per-Bot computers, mapped onto PiB linked computers / VPS.
 *
 * OpenBot gives each Bot its own container, volume, and browser profile.
 * PiB keeps one physical Mac or VPS and isolates Bots with:
 * - workspace relative folder `bots/{agentId}`
 * - browser profile id `bot-{agentId}`
 *
 * Workbench already executes inside `workspaceContext.folderRelativePath`.
 */

export const BOT_COMPUTER_FOLDER_PREFIX = 'bots'
export const MAX_BOT_FOLDER_LENGTH = 180

export interface BotComputerBinding {
  isolated: true
  deviceId?: string | null
  runtimeTarget?: string | null
  workspaceRelativePath: string
  browserProfileId: string
}

export interface IsolatedWorkbenchPaths {
  relativeFolder: string
  workingDirectory?: string
}

function cleanSegment(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isolatedBotFolderSegment(agentId: unknown): string | null {
  const id = cleanSegment(agentId)
  if (!id || id.length > 40 || !/^[a-z][a-z0-9._-]*$/.test(id)) return null
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\\')) return null
  return id
}

export function isolatedBotWorkspacePath(agentId: unknown): string | null {
  const segment = isolatedBotFolderSegment(agentId)
  return segment ? `${BOT_COMPUTER_FOLDER_PREFIX}/${segment}` : null
}

/**
 * Relative folders the VPS sidecar must mkdir before Hermes accepts a Bot run.
 * Hermes rejects missing `working_directory` with HTTP 400 (PiB: dispatch_rejected).
 */
export function botComputerFoldersToEnsure(folderRelativePath: unknown): string[] {
  const raw = typeof folderRelativePath === 'string'
    ? folderRelativePath.trim().replace(/^\/+|\/+$/g, '')
    : ''
  if (!raw || raw.includes('..')) return []
  const match = raw.match(new RegExp(`(?:^|/)${BOT_COMPUTER_FOLDER_PREFIX}/([a-z][a-z0-9._-]{0,39})$`, 'i'))
  if (!match) return []
  const segment = isolatedBotFolderSegment(match[1])
  if (!segment) return []
  const folders = new Set<string>([raw])
  if (raw.startsWith(`${BOT_COMPUTER_FOLDER_PREFIX}/`)) {
    folders.add(BOT_COMPUTER_FOLDER_PREFIX)
  }
  return Array.from(folders)
}

export function isolatedBotBrowserProfileId(agentId: unknown): string | null {
  const segment = isolatedBotFolderSegment(agentId)
  if (!segment) return null
  return `bot-${segment.replace(/\./g, '_')}`.slice(0, 64)
}

export function botFolderAlreadyIsolated(path: string, isolatedPath: string): boolean {
  const base = path.trim().replace(/\/+$/, '')
  if (!base || base === '.') return false
  if (base === isolatedPath) return true
  if (base.endsWith(`/${isolatedPath}`)) return true
  const prefix = `${BOT_COMPUTER_FOLDER_PREFIX}/`
  if (base === BOT_COMPUTER_FOLDER_PREFIX || base.startsWith(prefix)) return true
  return base.includes(`/${prefix}`)
}

export function joinIsolatedBotFolder(existingFolder: unknown, agentId: unknown): string | null {
  const isolated = isolatedBotWorkspacePath(agentId)
  if (!isolated) return null
  const raw = typeof existingFolder === 'string' ? existingFolder.trim() : ''
  const base = !raw || raw === '.' ? '' : raw.replace(/\/+$/, '')
  if (!base) return isolated
  if (base === isolated || base.endsWith(`/${isolated}`)) return base
  if (base === BOT_COMPUTER_FOLDER_PREFIX || base.startsWith(`${BOT_COMPUTER_FOLDER_PREFIX}/`)) {
    return isolated
  }
  const nestedAt = base.lastIndexOf(`/${BOT_COMPUTER_FOLDER_PREFIX}/`)
  if (nestedAt >= 0) {
    const next = `${base.slice(0, nestedAt)}/${isolated}`
    return next.length <= MAX_BOT_FOLDER_LENGTH ? next : isolated
  }
  const joined = `${base}/${isolated}`
  return joined.length <= MAX_BOT_FOLDER_LENGTH ? joined : isolated
}

function joinAbsoluteWorkingDirectory(root: string, relative: string): string {
  const trimmedRoot = root.trim().replace(/\/+$/, '')
  const trimmedRelative = relative.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (!trimmedRoot) return trimmedRelative
  if (!trimmedRelative) return trimmedRoot
  if (trimmedRoot.endsWith(`/${trimmedRelative}`) || trimmedRoot.endsWith(`/${BOT_COMPUTER_FOLDER_PREFIX}`)) {
    const nestedAt = trimmedRoot.lastIndexOf(`/${BOT_COMPUTER_FOLDER_PREFIX}`)
    if (nestedAt >= 0) return `${trimmedRoot.slice(0, nestedAt)}/${trimmedRelative}`
  }
  return `${trimmedRoot}/${trimmedRelative}`
}

export function applyBotIsolationToWorkbenchPaths(input: {
  agentId: unknown
  relativeFolder: string
  workingDirectory?: string
}): IsolatedWorkbenchPaths {
  const isolated = isolatedBotWorkspacePath(input.agentId)
  if (!isolated) {
    return {
      relativeFolder: input.relativeFolder,
      ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
    }
  }
  if (input.workingDirectory?.trim()) {
    return {
      relativeFolder: input.relativeFolder,
      workingDirectory: joinAbsoluteWorkingDirectory(input.workingDirectory, isolated),
    }
  }
  return {
    relativeFolder: joinIsolatedBotFolder(input.relativeFolder, input.agentId) || isolated,
  }
}

export function parseBotComputerBinding(value: unknown): BotComputerBinding | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const workspaceRelativePath = typeof row.workspaceRelativePath === 'string'
    ? row.workspaceRelativePath.trim()
    : ''
  const browserProfileId = typeof row.browserProfileId === 'string' ? row.browserProfileId.trim() : ''
  if (!workspaceRelativePath || !browserProfileId) return null
  if (row.isolated !== true && row.isolated !== undefined) return null
  return {
    isolated: true,
    workspaceRelativePath,
    browserProfileId,
    deviceId: typeof row.deviceId === 'string' ? row.deviceId.trim() : null,
    runtimeTarget: typeof row.runtimeTarget === 'string' ? row.runtimeTarget.trim() : null,
  }
}

export function buildBotComputerBinding(input: {
  agentId: string
  deviceId?: string | null
  runtimeTarget?: string | null
}): BotComputerBinding | null {
  const workspaceRelativePath = isolatedBotWorkspacePath(input.agentId)
  const browserProfileId = isolatedBotBrowserProfileId(input.agentId)
  if (!workspaceRelativePath || !browserProfileId) return null
  return {
    isolated: true,
    workspaceRelativePath,
    browserProfileId,
    deviceId: input.deviceId?.trim() || null,
    runtimeTarget: input.runtimeTarget?.trim() || null,
  }
}

export function isolationAgentIdForConversation(input: {
  channelKind?: string | null
  botInbox?: { toAgentId?: string | null } | null
  participantAgentIds?: string[] | null
}): string | null {
  const to = typeof input.botInbox?.toAgentId === 'string' ? input.botInbox.toAgentId.trim() : ''
  if (to) return to
  const first = input.participantAgentIds?.find((id) => typeof id === 'string' && id.trim())
  return first?.trim() || null
}
