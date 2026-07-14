import { createHash } from 'node:crypto'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const MAX_ENTRIES = 1_000
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_MANIFEST_BYTES = 100 * 1024 * 1024

export type ProjectManifestEntry =
  | { type: 'file'; path: string; sha256: string; size: number; executable?: true }
  | { type: 'directory'; path: string; size: 0; sha256?: never }

export interface ProjectContentManifest {
  version: 1
  projectId: string
  entries: ProjectManifestEntry[]
  entryCount: number
  totalBytes: number
  revision: string
}

export type ProjectSyncRequestStatus =
  | 'waiting_for_locations'
  | 'pending_inventory'
  | 'ready'
  | 'transferring'
  | 'synced'
  | 'conflict'
  | 'failed'
  | 'cancelled'

export interface ProjectSyncReplicaInput {
  replicaId: string
  locationId: string
  mappingId: string
  orgId: string
  projectId: string
  availability: 'online' | 'offline' | 'unknown'
  currentRevision: string | null
}

export interface ProjectSyncReplicaState extends ProjectSyncReplicaInput {
  status: 'offline' | 'awaiting_inventory' | 'inventory_received' | 'source' | 'pending_transfer' | 'synced' | 'conflict'
  inventoryRevision: string | null
  inventoryEntryCount: number | null
  inventoryTotalBytes: number | null
  desiredRevision: string | null
  inventoryObservedAt: string | null
  pristineBootstrap: boolean
}

export interface ProjectSyncWorkerBinding {
  capability: 'workspace.sync'
  requestId: string
  orgId: string
  projectId: string
  replicaId: string
  locationId: string
  mappingId: string
}

export interface ProjectSyncTransfer {
  transferId: string
  sourceReplicaId: string
  targetReplicaId: string
  expectedTargetRevision: string | null
  desiredRevision: string
  storagePrefix: string
  destructiveDeletes: false
  preserveTargetOnConflict: true
  status: 'planned' | 'verified' | 'conflict'
  verifiedAt: string | null
}

export interface ProjectSyncConflict {
  kind: 'competing_revisions' | 'target_drift' | 'non_destructive_apply_required' | 'unsupported_scale' | 'unsupported_path'
  status: 'open'
  automaticOverwriteAllowed: false
  revisions: string[]
  replicaIds: string[]
  detectedAt: string
}

export function applyProjectSyncRuntimeFailure(request: ProjectSyncRequest, report: {
  binding: ProjectSyncWorkerBinding
  transferId?: string
  reason: 'non_destructive_apply_required' | 'unsupported_scale' | 'unsupported_path' | 'target_drift' | 'source_drift' | 'integrity_failure'
  observedRevision?: string
  failedAt: string
}): ProjectSyncRequest {
  const failedAt = iso(report.failedAt, 'failedAt')
  const bound = assertWorkerBinding(request, report.binding)
  if ((report.reason === 'unsupported_path' || report.reason === 'unsupported_scale') && !report.transferId) {
    return {
      ...conflict(request, report.reason, [], [bound.replicaId], failedAt),
      stateVersion: request.stateVersion + 1,
    }
  }
  if (!['ready', 'transferring'].includes(request.status)) throw new Error('project sync request has no transferable work')
  if (report.reason === 'source_drift') {
    const replicaStates = request.replicaStates.map((state): ProjectSyncReplicaState => state.replicaId === bound.replicaId
      ? {
          ...state,
          inventoryRevision: null,
          inventoryEntryCount: null,
          inventoryTotalBytes: null,
          inventoryObservedAt: null,
          pristineBootstrap: false,
          desiredRevision: null,
          status: 'awaiting_inventory',
        }
      : { ...state, desiredRevision: null, status: state.availability === 'online' ? 'inventory_received' : 'offline' })
    return {
      ...request,
      stateVersion: request.stateVersion + 1,
      status: 'pending_inventory',
      proposedCanonicalRevision: null,
      transfers: [],
      conflict: null,
      replicaStates,
      updatedAt: failedAt,
    }
  }
  const transfer = request.transfers.find((candidate) => candidate.transferId === report.transferId
    && candidate.targetReplicaId === bound.replicaId && candidate.status === 'planned')
  if (!transfer) {
    throw new Error('project sync failure binding mismatch')
  }
  if (report.reason === 'integrity_failure') return {
    ...request,
    stateVersion: request.stateVersion + 1,
    status: 'failed',
    updatedAt: failedAt,
    replicaStates: request.replicaStates.map((state) => state.replicaId === bound.replicaId
      ? { ...state, status: 'conflict' }
      : state),
  }
  const conflictKind = report.reason === 'target_drift' ? 'target_drift' : report.reason
  if (!['target_drift', 'non_destructive_apply_required', 'unsupported_scale'].includes(conflictKind)) {
    throw new Error('project sync failure reason is invalid')
  }
  return {
    ...conflict(request, conflictKind as ProjectSyncConflict['kind'], [
      transfer.expectedTargetRevision ?? 'none', report.observedRevision ?? transfer.desiredRevision, transfer.desiredRevision,
    ], [transfer.sourceReplicaId, transfer.targetReplicaId], failedAt),
    stateVersion: request.stateVersion + 1,
  }
}

export interface ProjectSyncRequest {
  version: 1
  stateVersion: number
  requestId: string
  orgId: string
  projectId: string
  canonicalLocationId: string
  canonicalRevision: string | null
  proposedCanonicalRevision: string | null
  baseRevision: string | null
  requestedByUserId: string
  requestedAt: string
  updatedAt: string
  status: ProjectSyncRequestStatus
  conflictPolicy: 'preserve_both_require_resolution'
  deletionPolicy: 'no_automatic_deletes'
  transferProtocol: 'firebase-storage-cas-v1'
  continuousExecutorVerified: boolean
  replicaStates: ProjectSyncReplicaState[]
  transfers: ProjectSyncTransfer[]
  conflict: ProjectSyncConflict | null
}

function id(value: string, field: string): string {
  const clean = value.trim()
  if (!SAFE_ID.test(clean)) throw new Error(`${field} is invalid`)
  return clean
}

function iso(value: string, field: string): string {
  const clean = value.trim()
  if (!clean || !Number.isFinite(Date.parse(clean))) throw new Error(`${field} must be an ISO timestamp`)
  return new Date(clean).toISOString()
}

function manifestPath(value: string): string {
  const clean = value.trim()
  if (!clean || clean.length > 1024 || clean.startsWith('/') || clean.startsWith('~')
    || clean.includes('\\') || /[\u0000-\u001f]/.test(clean)) {
    throw new Error('path is not eligible for project sync')
  }
  const segments = clean.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('path is not eligible for project sync')
  }
  const lower = segments.map((segment) => segment.toLowerCase())
  const unsupportedPortableSegment = segments.some((segment) => {
    const normalized = segment.normalize('NFC')
    const stem = normalized.split('.')[0].toUpperCase()
    return normalized !== segment || Buffer.byteLength(normalized, 'utf8') > 255
      || /[<>:"|?*]/.test(normalized) || /[. ]$/.test(normalized)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
  })
  const name = lower.at(-1) ?? ''
  const forbiddenSegment = lower.some((segment) => ['.git', 'node_modules', '.pib-sync', '.partnersinbiz'].includes(segment))
  const forbiddenName = name === '.env' || name.startsWith('.env.')
    || ['id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'].includes(name)
    || /\.(?:pem|key|p12|pfx)$/.test(name)
  if (forbiddenSegment || forbiddenName) throw new Error('path is not eligible for project sync')
  if (unsupportedPortableSegment) throw new Error('project sync path is not portable across linked computers')
  return segments.join('/')
}

function stableManifestBody(projectId: string, entries: ProjectManifestEntry[]): string {
  return JSON.stringify({ version: 1, projectId, entries })
}

export function buildProjectContentManifest(input: {
  projectId: string
  entries: ProjectManifestEntry[]
}): ProjectContentManifest {
  const projectId = id(input.projectId, 'projectId')
  if (!Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES) {
    throw new Error(`project sync manifest exceeds ${MAX_ENTRIES} entries`)
  }
  const seen = new Set<string>()
  const portableSeen = new Set<string>()
  let totalBytes = 0
  const entries = input.entries.map((entry): ProjectManifestEntry => {
    const path = manifestPath(entry.path)
    if (seen.has(path)) throw new Error('project sync manifest contains a duplicate path')
    seen.add(path)
    const portableKey = path.normalize('NFC').toLocaleLowerCase('en-US')
    if (portableSeen.has(portableKey)) throw new Error('project sync manifest contains a cross-platform path collision')
    portableSeen.add(portableKey)
    if (entry.type === 'directory') {
      if (entry.size !== 0 || 'sha256' in entry && entry.sha256 !== undefined) {
        throw new Error('project sync directory entries cannot contain file content')
      }
      return { type: 'directory', path, size: 0 }
    }
    if (entry.type !== 'file') throw new Error('project sync supports only files and directories')
    const sha256 = entry.sha256.toLowerCase()
    if (!SHA256.test(sha256)) throw new Error('project sync file sha256 is invalid')
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('project sync file size is invalid')
    if (entry.size > MAX_FILE_BYTES) throw new Error('project sync maximum file size is 100 MiB')
    if (entry.executable !== undefined && entry.executable !== true) throw new Error('project sync executable flag is invalid')
    totalBytes += entry.size
    if (totalBytes > MAX_MANIFEST_BYTES) throw new Error('project sync manifest exceeds its maximum total size')
    return { type: 'file', path, sha256, size: entry.size, ...(entry.executable ? { executable: true as const } : {}) }
  }).sort((left, right) => left.path.localeCompare(right.path))
  const revision = createHash('sha256').update(stableManifestBody(projectId, entries)).digest('hex')
  return { version: 1, projectId, entries, entryCount: entries.length, totalBytes, revision }
}

export function validateProjectContentManifest(manifest: ProjectContentManifest, projectId: string): ProjectContentManifest {
  const rebuilt = buildProjectContentManifest({ projectId: manifest.projectId, entries: manifest.entries })
  if (rebuilt.projectId !== projectId || rebuilt.revision !== manifest.revision
    || rebuilt.entryCount !== manifest.entryCount || rebuilt.totalBytes !== manifest.totalBytes) {
    throw new Error('project sync manifest integrity check failed')
  }
  return rebuilt
}

function commonRevision(replicas: ProjectSyncReplicaInput[]): string | null {
  const revisions = new Set(replicas.map((replica) => replica.currentRevision))
  return revisions.size === 1 ? replicas[0].currentRevision : null
}

export function createProjectSyncRequest(input: {
  requestId: string
  orgId: string
  projectId: string
  canonicalLocationId: string
  requestedByUserId: string
  replicas: ProjectSyncReplicaInput[]
  continuousExecutorVerified?: boolean
  now: string
}): ProjectSyncRequest {
  const requestId = id(input.requestId, 'requestId')
  const orgId = id(input.orgId, 'orgId')
  const projectId = id(input.projectId, 'projectId')
  const canonicalLocationId = id(input.canonicalLocationId, 'canonicalLocationId')
  const requestedByUserId = id(input.requestedByUserId, 'requestedByUserId')
  const now = iso(input.now, 'now')
  if (input.replicas.length < 2) throw new Error('project sync requires at least two active replicas')
  const seen = new Set<string>()
  const replicas = input.replicas.map((replica): ProjectSyncReplicaInput => {
    const clean = {
      replicaId: id(replica.replicaId, 'replicaId'),
      locationId: id(replica.locationId, 'locationId'),
      mappingId: id(replica.mappingId, 'mappingId'),
      orgId: id(replica.orgId, 'replica.orgId'),
      projectId: id(replica.projectId, 'replica.projectId'),
      availability: replica.availability,
      currentRevision: replica.currentRevision,
    }
    if (clean.orgId !== orgId || clean.projectId !== projectId) throw new Error('project sync replica tenant mismatch')
    if (seen.has(clean.replicaId) || [...seen].some((key) => key === `location:${clean.locationId}`)) {
      throw new Error('project sync replicas must be unique')
    }
    seen.add(clean.replicaId)
    seen.add(`location:${clean.locationId}`)
    return clean
  })
  if (!replicas.some((replica) => replica.locationId === canonicalLocationId)) {
    throw new Error('canonical project sync location must be an active replica')
  }
  const baseRevision = commonRevision(replicas)
  const offline = replicas.some((replica) => replica.availability !== 'online')
  return {
    version: 1,
    stateVersion: 1,
    requestId,
    orgId,
    projectId,
    canonicalLocationId,
    canonicalRevision: baseRevision,
    proposedCanonicalRevision: null,
    baseRevision,
    requestedByUserId,
    requestedAt: now,
    updatedAt: now,
    status: offline ? 'waiting_for_locations' : 'pending_inventory',
    conflictPolicy: 'preserve_both_require_resolution',
    deletionPolicy: 'no_automatic_deletes',
    transferProtocol: 'firebase-storage-cas-v1',
    continuousExecutorVerified: input.continuousExecutorVerified === true,
    replicaStates: replicas.map((replica) => ({
      ...replica,
      status: replica.availability === 'online' ? 'awaiting_inventory' : 'offline',
      inventoryRevision: null,
      inventoryEntryCount: null,
      inventoryTotalBytes: null,
      desiredRevision: null,
      inventoryObservedAt: null,
      pristineBootstrap: false,
    })),
    transfers: [],
    conflict: null,
  }
}

function assertWorkerBinding(
  request: ProjectSyncRequest,
  binding: ProjectSyncWorkerBinding,
): ProjectSyncReplicaState {
  if (binding.capability !== 'workspace.sync') throw new Error('project sync requires workspace.sync capability')
  const replica = request.replicaStates.find((candidate) => candidate.replicaId === binding.replicaId)
  if (!replica || binding.requestId !== request.requestId || binding.orgId !== request.orgId
    || binding.projectId !== request.projectId || binding.locationId !== replica.locationId
    || binding.mappingId !== replica.mappingId) {
    throw new Error('project sync worker binding mismatch')
  }
  return replica
}

function transferId(requestId: string, sourceReplicaId: string, targetReplicaId: string, revision: string): string {
  return `sync_${createHash('sha256').update(`${requestId}\0${sourceReplicaId}\0${targetReplicaId}\0${revision}`).digest('hex').slice(0, 40)}`
}

function storagePrefix(request: ProjectSyncRequest, revision: string): string {
  return `project-sync/${request.orgId}/${request.projectId}/${revision}`
}

function conflict(
  request: ProjectSyncRequest,
  kind: ProjectSyncConflict['kind'],
  revisions: string[],
  replicaIds: string[],
  detectedAt: string,
): ProjectSyncRequest {
  return {
    ...request,
    status: 'conflict',
    updatedAt: detectedAt,
    transfers: [],
    conflict: {
      kind,
      status: 'open',
      automaticOverwriteAllowed: false,
      revisions: Array.from(new Set(revisions)).sort(),
      replicaIds: Array.from(new Set(replicaIds)).sort(),
      detectedAt,
    },
    replicaStates: request.replicaStates.map((state) => ({ ...state, status: 'conflict' })),
  }
}

function reconcile(request: ProjectSyncRequest, now: string): ProjectSyncRequest {
  if (request.replicaStates.some((state) => state.inventoryRevision === null)) {
    const waiting = request.replicaStates.some((state) => state.availability !== 'online')
    return { ...request, status: waiting ? 'waiting_for_locations' : 'pending_inventory', updatedAt: now }
  }
  const states = request.replicaStates
  const revisions = Array.from(new Set(states.map((state) => state.inventoryRevision!)))
  if (revisions.length === 1) {
    const revision = revisions[0]
    return {
      ...request,
      status: 'synced',
      baseRevision: revision,
      canonicalRevision: revision,
      proposedCanonicalRevision: null,
      updatedAt: now,
      transfers: [],
      conflict: null,
      replicaStates: states.map((state) => ({
        ...state, currentRevision: revision, desiredRevision: revision, pristineBootstrap: false, status: 'synced',
      })),
    }
  }
  if (!request.baseRevision) {
    const canonical = states.find((state) => state.locationId === request.canonicalLocationId)
    const desiredRevision = canonical?.inventoryRevision ?? null
    const targets = desiredRevision
      ? states.filter((state) => state.inventoryRevision !== desiredRevision)
      : []
    const safeBootstrap = Boolean(canonical && !canonical.pristineBootstrap && desiredRevision && targets.length > 0
      && targets.every((state) => state.locationId !== request.canonicalLocationId
        && state.pristineBootstrap === true
        && state.inventoryEntryCount === 0
        && state.inventoryTotalBytes === 0))
    if (!safeBootstrap || !canonical || !desiredRevision) {
      return conflict(request, 'competing_revisions', revisions, states.map((state) => state.replicaId), now)
    }
    const transfers: ProjectSyncTransfer[] = targets.map((target) => ({
      transferId: transferId(request.requestId, canonical.replicaId, target.replicaId, desiredRevision),
      sourceReplicaId: canonical.replicaId,
      targetReplicaId: target.replicaId,
      expectedTargetRevision: target.inventoryRevision,
      desiredRevision,
      storagePrefix: storagePrefix(request, desiredRevision),
      destructiveDeletes: false,
      preserveTargetOnConflict: true,
      status: 'planned',
      verifiedAt: null,
    }))
    return {
      ...request,
      status: 'ready',
      proposedCanonicalRevision: desiredRevision,
      updatedAt: now,
      transfers,
      conflict: null,
      replicaStates: states.map((state) => ({
        ...state,
        desiredRevision,
        status: state.replicaId === canonical.replicaId ? 'source'
          : state.inventoryRevision === desiredRevision ? 'synced' : 'pending_transfer',
      })),
    }
  }
  const changed = states.filter((state) => state.inventoryRevision !== request.baseRevision)
  const changedRevisions = Array.from(new Set(changed.map((state) => state.inventoryRevision!)))
  if (changedRevisions.length !== 1) {
    return conflict(request, 'competing_revisions', revisions, changed.map((state) => state.replicaId), now)
  }
  const desiredRevision = changedRevisions[0]
  const canonical = states.find((state) => state.locationId === request.canonicalLocationId)!
  const source = canonical.inventoryRevision === desiredRevision
    ? canonical
    : [...changed].sort((left, right) => left.replicaId.localeCompare(right.replicaId))[0]
  const targets = states.filter((state) => state.inventoryRevision !== desiredRevision)
  const transfers: ProjectSyncTransfer[] = targets.map((target) => ({
    transferId: transferId(request.requestId, source.replicaId, target.replicaId, desiredRevision),
    sourceReplicaId: source.replicaId,
    targetReplicaId: target.replicaId,
    expectedTargetRevision: target.inventoryRevision,
    desiredRevision,
    storagePrefix: storagePrefix(request, desiredRevision),
    destructiveDeletes: false,
    preserveTargetOnConflict: true,
    status: 'planned',
    verifiedAt: null,
  }))
  return {
    ...request,
    status: 'ready',
    proposedCanonicalRevision: desiredRevision,
    updatedAt: now,
    transfers,
    conflict: null,
    replicaStates: states.map((state) => ({
      ...state,
      desiredRevision,
      status: state.replicaId === source.replicaId ? 'source'
        : state.inventoryRevision === desiredRevision ? 'synced' : 'pending_transfer',
    })),
  }
}

export function applyProjectSyncInventory(request: ProjectSyncRequest, report: {
  binding: ProjectSyncWorkerBinding
  manifest: ProjectContentManifest
  pristineBootstrap?: boolean
  observedAt: string
}): ProjectSyncRequest {
  if (['conflict', 'failed', 'cancelled'].includes(request.status)) {
    throw new Error('project sync request is not accepting inventory')
  }
  const observedAt = iso(report.observedAt, 'observedAt')
  const bound = assertWorkerBinding(request, report.binding)
  const manifest = validateProjectContentManifest(report.manifest, request.projectId)
  const replicaStates = request.replicaStates.map((state): ProjectSyncReplicaState => state.replicaId === bound.replicaId
    ? {
        ...state,
        availability: 'online',
        currentRevision: manifest.revision,
        inventoryRevision: manifest.revision,
        inventoryEntryCount: manifest.entryCount,
        inventoryTotalBytes: manifest.totalBytes,
        inventoryObservedAt: observedAt,
        pristineBootstrap: report.pristineBootstrap === true,
        status: 'inventory_received',
      }
    : state)
  return {
    ...reconcile({ ...request, replicaStates, updatedAt: observedAt }, observedAt),
    stateVersion: request.stateVersion + 1,
  }
}

export function applyProjectSyncTransferReceipt(request: ProjectSyncRequest, report: {
  binding: ProjectSyncWorkerBinding
  transferId: string
  beforeRevision: string | null
  appliedRevision: string
  verifiedManifestRevision: string
  verifiedAt: string
}): ProjectSyncRequest {
  if (request.status !== 'ready' && request.status !== 'transferring') {
    throw new Error('project sync request has no transferable work')
  }
  const verifiedAt = iso(report.verifiedAt, 'verifiedAt')
  const bound = assertWorkerBinding(request, report.binding)
  const transfer = request.transfers.find((candidate) => candidate.transferId === report.transferId
    && candidate.targetReplicaId === bound.replicaId)
  if (!transfer || transfer.status !== 'planned') throw new Error('project sync transfer binding mismatch')
  if (report.beforeRevision !== transfer.expectedTargetRevision) {
    return { ...conflict(request, 'target_drift', [
      transfer.expectedTargetRevision ?? 'none', report.beforeRevision ?? 'none', transfer.desiredRevision,
    ], [transfer.sourceReplicaId, transfer.targetReplicaId], verifiedAt), stateVersion: request.stateVersion + 1 }
  }
  if (report.appliedRevision !== transfer.desiredRevision
    || report.verifiedManifestRevision !== transfer.desiredRevision) {
    throw new Error('project sync transfer receipt did not verify the desired revision')
  }
  const transfers = request.transfers.map((candidate): ProjectSyncTransfer => candidate.transferId === transfer.transferId
    ? { ...candidate, status: 'verified', verifiedAt }
    : candidate)
  const replicaStates = request.replicaStates.map((state): ProjectSyncReplicaState => state.replicaId === transfer.targetReplicaId
    ? {
        ...state,
        currentRevision: transfer.desiredRevision,
        inventoryRevision: transfer.desiredRevision,
        desiredRevision: transfer.desiredRevision,
        pristineBootstrap: false,
        status: 'synced',
      }
    : state)
  const complete = transfers.every((candidate) => candidate.status === 'verified')
  if (!complete) return {
    ...request, transfers, replicaStates, status: 'transferring', updatedAt: verifiedAt,
    stateVersion: request.stateVersion + 1,
  }
  const revision = request.proposedCanonicalRevision ?? transfer.desiredRevision
  return {
    ...request,
    stateVersion: request.stateVersion + 1,
    transfers,
    replicaStates: replicaStates.map((state) => ({
      ...state, currentRevision: revision, desiredRevision: revision, pristineBootstrap: false, status: 'synced',
    })),
    status: 'synced',
    baseRevision: revision,
    canonicalRevision: revision,
    proposedCanonicalRevision: null,
    conflict: null,
    updatedAt: verifiedAt,
  }
}

export function cancelProjectSyncRequest(request: ProjectSyncRequest, cancelledAt: string): ProjectSyncRequest {
  if (['cancelled', 'synced'].includes(request.status)) return request
  const updatedAt = iso(cancelledAt, 'cancelledAt')
  return {
    ...request,
    stateVersion: request.stateVersion + 1,
    status: 'cancelled',
    updatedAt,
    proposedCanonicalRevision: null,
    transfers: [],
    conflict: null,
    replicaStates: request.replicaStates.map((state) => ({
      ...state,
      desiredRevision: null,
      pristineBootstrap: false,
      status: state.availability === 'online'
        ? state.inventoryRevision ? 'inventory_received' : 'awaiting_inventory'
        : 'offline',
    })),
  }
}
