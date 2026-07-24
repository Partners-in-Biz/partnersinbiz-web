import type { WorkbenchChangeFile, WorkbenchFileNode } from './types'
import type { PublicWorkbenchJob, WorkbenchOperation, WorkbenchResult } from './jobs'

export interface WorkbenchJobRunOptions {
  approveWrite?: boolean
  pollDelayMs?: number
  maxPolls?: number
  signal?: AbortSignal
}

function idempotencyKey(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `workbench-${random}`
}

async function responseData(response: Response): Promise<PublicWorkbenchJob> {
  const body = await response.json().catch(() => null) as { data?: PublicWorkbenchJob; error?: string } | null
  if (!response.ok || !body?.data) throw new Error(body?.error || `Workbench request failed (${response.status})`)
  return body.data
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

export async function runConversationWorkbenchJob(
  conversationId: string,
  operation: WorkbenchOperation,
  options: WorkbenchJobRunOptions = {},
): Promise<PublicWorkbenchJob> {
  const base = `/api/v1/conversations/${encodeURIComponent(conversationId)}/workbench/jobs`
  let job = await responseData(await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() },
    body: JSON.stringify({ operation }),
    signal: options.signal,
  }))

  if (job.status === 'awaiting_approval') {
    if (!options.approveWrite) throw new Error('This file write requires explicit approval')
    job = await responseData(await fetch(`${base}/${encodeURIComponent(job.jobId)}/approve`, {
      method: 'POST',
      signal: options.signal,
    }))
  }

  const maxPolls = options.maxPolls ?? 80
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (job.status === 'completed') return job
    if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
      throw new Error(job.error || `Workbench job ${job.status}`)
    }
    await wait(options.pollDelayMs ?? 250, options.signal)
    job = await responseData(await fetch(`${base}/${encodeURIComponent(job.jobId)}`, {
      cache: 'no-store',
      signal: options.signal,
    }))
  }
  throw new Error('Workbench job timed out waiting for the linked computer')
}

export function workbenchEntriesToTree(
  entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }>,
): WorkbenchFileNode[] {
  type MutableNode = WorkbenchFileNode & { children?: MutableNode[] }
  const roots: MutableNode[] = []
  const byPath = new Map<string, MutableNode>()

  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = entry.path.split('/').filter(Boolean)
    let parentChildren = roots
    let currentPath = ''
    segments.forEach((name, index) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name
      const final = index === segments.length - 1
      let node = byPath.get(currentPath)
      if (!node) {
        const kind = final ? entry.type : 'directory'
        node = { name, path: currentPath, kind, ...(kind === 'directory' ? { children: [] } : {}) }
        byPath.set(currentPath, node)
        parentChildren.push(node)
      }
      if (node.kind === 'directory') {
        node.children ??= []
        parentChildren = node.children
      }
    })
  }

  const sort = (nodes: MutableNode[]): WorkbenchFileNode[] => nodes
    .sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1)
    .map((node) => node.kind === 'directory' ? { ...node, children: sort(node.children ?? []) } : node)
  return sort(roots)
}

export function mergeWorkbenchDirectory(
  tree: WorkbenchFileNode[],
  directoryPath: string,
  entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }>,
): WorkbenchFileNode[] {
  const incomingTree = workbenchEntriesToTree(entries)
  const findDirectory = (nodes: WorkbenchFileNode[]): WorkbenchFileNode | undefined => {
    for (const node of nodes) {
      if (node.path === directoryPath && node.kind === 'directory') return node
      const found = node.children ? findDirectory(node.children) : undefined
      if (found) return found
    }
    return undefined
  }
  const incomingDirectory = findDirectory(incomingTree)
  const children = incomingDirectory?.children ?? (directoryPath ? [] : incomingTree)
  const replace = (nodes: WorkbenchFileNode[]): WorkbenchFileNode[] => nodes.map((node) => {
    if (node.path === directoryPath && node.kind === 'directory') return { ...node, children }
    return node.children ? { ...node, children: replace(node.children) } : node
  })
  return directoryPath ? replace(tree) : incomingTree
}

function statusFromGit(value: string): WorkbenchChangeFile['status'] {
  const normalized = value.toLowerCase()
  if (normalized.includes('rename')) return 'renamed'
  if (normalized.includes('delete')) return 'deleted'
  if (normalized.includes('add') || normalized.includes('untracked') || normalized === '??') return 'added'
  if (normalized.includes('modif') || normalized.includes('staged') || normalized.includes('unstaged')) return 'modified'
  return 'unknown'
}

export function workbenchStatusToChanges(
  changes: Array<{ path: string; status: string }>,
): WorkbenchChangeFile[] {
  return changes.map((change) => ({ path: change.path, status: statusFromGit(change.status) }))
}

export function attachWorkbenchDiffs(changes: WorkbenchChangeFile[], diff: string): WorkbenchChangeFile[] {
  const patches = new Map<string, string[]>()
  const sections = diff.split(/(?=^diff --git )/m).filter(Boolean)
  for (const section of sections) {
    const header = section.match(/^diff --git (?:"?a\/(.*?)"?) (?:"?b\/(.*?)"?)(?:\n|$)/)
    if (!header) continue
    for (const path of [header[1], header[2]]) {
      const normalized = path.replace(/\\"/g, '"')
      const existing = patches.get(normalized) ?? []
      existing.push(section.trimEnd())
      patches.set(normalized, existing)
    }
  }
  return changes.map((change) => {
    const patch = patches.get(change.path)?.join('\n')
    return patch ? { ...change, patch } : change
  })
}

export function workbenchJobResult<T extends WorkbenchResult>(job: PublicWorkbenchJob): T {
  if (job.status !== 'completed' || !job.result) throw new Error('Workbench job completed without a result')
  return job.result as T
}
