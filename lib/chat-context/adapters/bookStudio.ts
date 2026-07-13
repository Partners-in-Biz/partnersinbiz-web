import { adminDb } from '@/lib/firebase/admin'
import type { ApiRole } from '@/lib/api/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { BookStudioCapabilities } from '@/lib/book-studio/capabilities'
import { resolveBookStudioCapabilities } from '@/lib/book-studio/capabilities'
import { LIFECYCLE_STATES, TRANSITIONS, meetsMinState, resolveLifecycleState, runLifecycleGuard } from '@/lib/book-studio/lifecycle'
import type { BookStudioRecord, BookStudioStatus } from '@/lib/book-studio/types'
import { bookOutputAnchor } from '@/lib/book-studio/output-anchor'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { safePreviewUrl } from '@/lib/chat-context/safeUrl'
import type { ChatArtifactSummary, ChatContextReadModel, ContextDisplayState } from '@/lib/chat-context/types'

const CHILD_LIMIT = 50
type RecordWithId = BookStudioRecord & { id: string }

function label(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
function titleCase(value: string): string { return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }
function contentState(status: unknown): ContextDisplayState {
  return status === 'approved' ? 'complete' : status === 'edited' ? 'review' : status === 'generated' ? 'ready' : 'needs_input'
}
function recordState(status: BookStudioStatus | undefined): ContextDisplayState {
  if (status === 'approved' || status === 'approved_for_manual_next_step') return 'complete'
  if (status === 'internal_review' || status === 'client_review' || status === 'needs_review' || status === 'ready_for_human_review') return 'review'
  if (status === 'blocked') return 'blocked'
  if (status === 'archived') return 'archived'
  return 'ready'
}
function actionCapabilities(caps: BookStudioCapabilities): string[] {
  return [caps.canView && 'view', caps.canCreate && 'create', caps.canEdit && 'edit', caps.canEvidenceRights && 'evidence_rights', caps.canApprovalGates && 'approval_gates', caps.canPublishingPackets && 'publishing_packets', caps.canArchiveDelete && 'archive_delete'].filter(Boolean) as string[]
}

function projectRecordHref(base: string, orgId: string, tab: 'content' | 'metadata' | 'assembly', anchor: string): string {
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}${new URLSearchParams({ orgId, tab }).toString()}#${anchor}`
}

function gateState(status: unknown): ContextDisplayState {
  if (status === 'pass' || status === 'passed' || status === 'not_applicable' || status === 'approved' || status === 'cleared' || status === 'owned' || status === 'licensed' || status === 'public_domain') return 'complete'
  if (status === 'block' || status === 'blocked') return 'blocked'
  if (status === 'warning' || status === 'needs_review' || status === 'pending_review' || status === 'client_review' || status === 'internal_review' || status === 'ready_for_human_review') return 'review'
  return 'needs_approval'
}

export function buildBookStudioProjectModel(input: {
  project: RecordWithId
  chapters: RecordWithId[]
  pages: RecordWithId[]
  rightsLedgers: RecordWithId[]
  publishingPackets: RecordWithId[]
  capabilities: BookStudioCapabilities
  role: ApiRole
  href?: string
  artifactId?: string
}): ChatContextReadModel {
  const { project, capabilities } = input
  const lifecycle = resolveLifecycleState(project)
  const href = input.href ?? (input.role === 'client' ? `/portal/book-studio/${encodeURIComponent(project.id)}` : `/admin/org/${encodeURIComponent(project.orgId)}/book-studio/${encodeURIComponent(project.id)}`)
  const apiScope = `?${new URLSearchParams({ orgId: project.orgId }).toString()}`
  const transitionHref = `/api/v1/${input.role === 'client' ? 'portal/' : ''}book-studio/projects/${encodeURIComponent(project.id)}/transition${apiScope}`
  const assembleHref = `/api/v1/book-studio/projects/${encodeURIComponent(project.id)}/assemble${apiScope}`
  const canvasHref = `/api/v1/book-studio/projects/${encodeURIComponent(project.id)}/open-in-canvas${apiScope}`
  const manifest = capabilities.canPublishingPackets && project.packageManifest && typeof project.packageManifest === 'object' ? project.packageManifest as Record<string, unknown> : undefined
  const allFiles = Array.isArray(manifest?.files) ? manifest.files as Array<Record<string, unknown>> : []
  const requestedFileIndex = input.artifactId?.startsWith('book_studio:') ? Number(input.artifactId.split(':').at(-1)) : NaN
  const files = Number.isInteger(requestedFileIndex) && requestedFileIndex >= 0 && requestedFileIndex < allFiles.length
    ? [Object.assign({}, allFiles[requestedFileIndex], { __sourceIndex: requestedFileIndex })]
    : allFiles.slice(0, 10)
  const qaStatus = label(manifest?.qaStatus, 'missing_evidence')
  const nextLifecycle = TRANSITIONS[lifecycle].find((state) => state !== 'draft')
  const embeddedRights = capabilities.canEvidenceRights && project.rightsLedger && typeof project.rightsLedger === 'object' ? project.rightsLedger as Record<string, unknown> : undefined
  const fallbackRights = capabilities.canEvidenceRights ? input.rightsLedgers[0] : undefined
  const effectiveRights = embeddedRights ?? fallbackRights
  const transitionGuard = nextLifecycle ? runLifecycleGuard(nextLifecycle, {
    chapters: input.chapters,
    pages: input.pages,
    // The transition route reads the ledger embedded on the project. A
    // collection record is useful evidence, but cannot authorize this action.
    rightsLedger: nextLifecycle === 'rights_cleared' ? embeddedRights : effectiveRights,
    packageManifest: manifest,
  }) : { ok: false, blockers: [] }
  const embeddedPackets = Array.isArray(project.reviewPackets) ? project.reviewPackets.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
  const publishingPackets = embeddedPackets.length ? embeddedPackets.map((item, index) => ({ id: label(item.id, `packet-${index + 1}`), ...item } as RecordWithId)) : input.publishingPackets
  const gates = capabilities.canApprovalGates && Array.isArray(project.gates) ? project.gates.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
  const artifacts: ChatArtifactSummary[] = [{
    id: `book_studio:project:${encodeURIComponent(project.id)}`, studioKind: 'book_studio', resourceType: 'project', resourceId: project.id,
    title: label(project.title, 'Untitled book'), artifactKind: 'book', state: lifecycle === 'live' ? 'published' : lifecycle === 'archived' ? 'archived' : recordState(project.status),
    statusLabel: titleCase(lifecycle), href, actions: [
      { id: 'open', label: 'Open book', href },
      ...(capabilities.isOperator && capabilities.canEdit && lifecycle !== 'archived' ? [
        ...(meetsMinState(lifecycle, 'rights_cleared') ? [{ id: 'assemble', label: 'Assemble files', href: assembleHref, method: 'POST' as const, body: { orgId: project.orgId } }] : []),
        { id: 'open-in-canvas', label: 'Open in Canvas', href: canvasHref, method: 'POST' as const, body: { orgId: project.orgId } },
      ] : []),
      ...(capabilities.canApprovalGates && nextLifecycle && transitionGuard.ok && lifecycle !== 'archived' && (input.role !== 'client' || nextLifecycle === 'content_complete') ? [{ id: 'transition', label: `Move to ${titleCase(nextLifecycle)}`, href: transitionHref, method: 'POST' as const, body: { orgId: project.orgId, toState: nextLifecycle } }] : []),
    ],
  }]
  for (const [visibleIndex, file] of files.entries()) {
    const fileIndex = typeof file.__sourceIndex === 'number' ? file.__sourceIndex : visibleIndex
    const role = label(file.role, 'output')
    const url = safePreviewUrl(typeof file.href === 'string' ? file.href : undefined)
    const outputAnchor = bookOutputAnchor(file, fileIndex)
    artifacts.push({
      id: `book_studio:${role}:${encodeURIComponent(project.id)}:${fileIndex}`, studioKind: 'book_studio', resourceType: role, resourceId: `${project.id}:${role}:${fileIndex}`,
      title: label(file.label, titleCase(role)), artifactKind: 'document', state: qaStatus === 'approved' || qaStatus === 'pass' ? 'complete' : qaStatus === 'block' ? 'blocked' : 'review',
      statusLabel: titleCase(qaStatus), preview: url ? { kind: 'document', url } : { kind: 'none' }, version: manifest?.version == null ? undefined : String(manifest.version),
      review: { required: !['approved', 'pass'].includes(qaStatus), status: qaStatus },
      href: url ?? projectRecordHref(href, project.orgId, 'assembly', outputAnchor),
      actions: [{ id: 'open', label: 'Open book', href }, ...(url ? [{ id: 'review-output', label: 'Review file', href: url }] : [])],
    })
  }
  if (capabilities.canPublishingPackets) for (const packet of publishingPackets.slice(0, CHILD_LIMIT)) artifacts.push({
    id: `book_studio:publishing_packet:${encodeURIComponent(packet.id)}`, studioKind: 'book_studio', resourceType: 'publishing_packet', resourceId: packet.id,
    title: label(packet.title ?? packet.name, 'Publishing packet'), artifactKind: 'document', state: recordState(packet.status), statusLabel: titleCase(packet.status ?? 'draft'), href: projectRecordHref(href, project.orgId, 'assembly', '').replace(/#$/, ''),
    actions: [{ id: 'open', label: 'Open publishing packet', href: projectRecordHref(href, project.orgId, 'assembly', '').replace(/#$/, '') }],
  })
  const qaBlocked = qaStatus === 'block' || qaStatus === 'missing_evidence'
  const attention = [
    ...(capabilities.canApprovalGates && capabilities.canPublishingPackets && qaStatus === 'pending_review' ? [{ id: 'qa', label: 'Quality review required', state: 'review' as const, detail: 'Review the assembled production files.', href }] : []),
    ...(capabilities.canApprovalGates && capabilities.canPublishingPackets && qaBlocked ? [{ id: 'qa', label: 'Quality gate blocked', state: 'blocked' as const, detail: 'The assembled files did not pass quality review.', href }] : []),
  ]
  const nextAction = label(project.nextAction, attention[0]?.label ?? 'Open the book project')
  return {
    context: { kind: 'studio_artifact', id: `book_studio:project:${encodeURIComponent(project.id)}`, orgId: project.orgId, label: label(project.title, 'Untitled book'), icon: 'book_studio', href },
    pulse: { label: titleCase(lifecycle), progress: { complete: Math.max(0, LIFECYCLE_STATES.indexOf(lifecycle)), total: LIFECYCLE_STATES.length }, metrics: [
      { id: 'chapters', label: 'Chapters', value: input.chapters.length }, { id: 'pages', label: 'Pages', value: input.pages.length }, { id: 'outputs', label: 'Outputs', value: files.length },
      ...(capabilities.canPublishingPackets ? [{ id: 'assembly', label: 'Assembly', value: titleCase(label(manifest?.status, 'not assembled')) }] : []),
      ...(capabilities.canApprovalGates ? [{ id: 'review', label: 'Review', value: titleCase(label(project.reviewStatus, qaStatus)) }] : []),
    ], next: { id: 'next-action', label: nextAction, state: attention[0]?.state ?? 'ready', href, actions: [{ id: 'open', label: 'Open book', href }] } },
    groups: [
      { id: 'chapters', label: 'Chapters', items: input.chapters.slice(0, CHILD_LIMIT).map((item) => ({ id: item.id, label: label(item.title, 'Untitled chapter'), state: contentState(item.status), detail: titleCase(item.status ?? 'draft'), href: projectRecordHref(href, project.orgId, 'content', `chapter-${encodeURIComponent(item.id)}`) })) },
      { id: 'pages', label: 'Pages', items: input.pages.slice(0, CHILD_LIMIT).map((item) => ({ id: item.id, label: label(item.title ?? item.name, titleCase(label(item.kind, 'Page'))), state: contentState(item.status), detail: titleCase(item.status ?? 'draft'), href: projectRecordHref(href, project.orgId, 'content', `page-${encodeURIComponent(item.id)}`) })) },
      { id: 'governance', label: 'Rights and quality', items: [
        ...(embeddedRights ? [{ id: 'rights', label: 'Rights evidence', state: gateState(embeddedRights.status), detail: titleCase(label(embeddedRights.status, 'missing_evidence')), href: projectRecordHref(href, project.orgId, 'metadata', '').replace(/#$/, '') }] : []),
        ...(!embeddedRights && fallbackRights ? [{ id: `rights:${fallbackRights.id}`, label: 'Rights evidence', state: gateState(fallbackRights.status), detail: titleCase(fallbackRights.status ?? 'missing_evidence'), href: projectRecordHref(href, project.orgId, 'metadata', '').replace(/#$/, '') }] : []),
        ...gates.map((item, index) => ({ id: `gate:${label(item.id, String(index + 1))}`, label: label(item.label, 'Approval gate'), state: gateState(item.status), detail: titleCase(label(item.status, 'not_started')), href })),
        ...(capabilities.canApprovalGates && project.reviewStatus ? [{ id: 'review-status', label: 'Project review', state: gateState(project.reviewStatus), detail: titleCase(label(project.reviewStatus, 'not_started')), href }] : []),
        ...(capabilities.canApprovalGates && capabilities.canPublishingPackets ? [{ id: 'qa', label: 'Quality assurance', state: qaStatus === 'approved' || qaStatus === 'pass' ? 'complete' as const : qaBlocked ? 'blocked' as const : 'review' as const, detail: titleCase(qaStatus), href }] : []),
      ] },
    ], artifacts, attention, activity: [], capabilities: actionCapabilities(capabilities), asOf: new Date().toISOString(),
  }
}

async function scopedRecords(collection: string, orgId: string, projectId: string): Promise<RecordWithId[]> {
  const snap = await adminDb.collection(collection).where('orgId', '==', orgId).where('projectId', '==', projectId).limit(CHILD_LIMIT).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as RecordWithId)).filter((item) => item.orgId === orgId && item.projectId === projectId && !item.deleted).slice(0, CHILD_LIMIT)
}

export const bookStudioChatContextAdapter: ChatContextAdapter = {
  async resolve({ id, artifactId, user }) {
    if (!id.startsWith('book_studio:project:')) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    let projectId: string
    try { projectId = decodeURIComponent(id.slice('book_studio:project:'.length)) } catch { return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' } }
    if (!projectId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const refs = await resolveContextReferences([{ type: 'studio_artifact', id }], user)
    const ref = refs.find((item) => item.type === 'studio_artifact' && item.id === id)
    if (!ref?.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
    const project = projectSnap.exists ? projectSnap.data() as BookStudioRecord | undefined : undefined
    if (!project || project.deleted || project.orgId !== ref.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const orgSnap = await adminDb.collection('organizations').doc(ref.orgId).get()
    if (!orgSnap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const capabilities = resolveBookStudioCapabilities(orgSnap.data()?.settings, user.role, user.role === 'admin' || user.role === 'ai')
    if (!capabilities.canView) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const [chapters, pages, rightsLedgers, recentPublishingPackets] = await Promise.all([
      scopedRecords('book_studio_chapters', ref.orgId, projectId), scopedRecords('book_studio_pages', ref.orgId, projectId),
      capabilities.canEvidenceRights ? scopedRecords('book_studio_rights_ledgers', ref.orgId, projectId) : Promise.resolve([]),
      capabilities.canPublishingPackets ? scopedRecords('book_studio_publishing_packets', ref.orgId, projectId) : Promise.resolve([]),
    ])
    let publishingPackets = recentPublishingPackets
    if (capabilities.canPublishingPackets && artifactId?.startsWith('book_studio:publishing_packet:')) {
      const packetId = artifactId.slice('book_studio:publishing_packet:'.length)
      const packetSnap = await adminDb.collection('book_studio_publishing_packets').doc(packetId).get()
      const packet = packetSnap.exists ? { id: packetId, ...packetSnap.data() } as RecordWithId : undefined
      if (packet && packet.orgId === ref.orgId && packet.projectId === projectId && !packet.deleted) publishingPackets = [packet]
    }
    return { ok: true, model: buildBookStudioProjectModel({ project: { id: projectId, ...project }, chapters, pages, rightsLedgers, publishingPackets, capabilities, role: user.role, href: ref.href, artifactId }) }
  },
}
