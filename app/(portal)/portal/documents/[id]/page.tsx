'use client'
export const dynamic = 'force-dynamic'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import { DocumentReviewRail } from '@/components/client-documents/DocumentReviewRail'
import { DocumentTaskList } from '@/components/client-documents/DocumentTaskList'
import { DocumentPresence } from '@/components/client-documents/DocumentPresence'
import { VersionHistoryDrawer } from '@/components/client-documents/VersionHistoryDrawer'
import { SignatureRequestPanel } from '@/components/client-documents/SignatureRequestPanel'
import { ShareSettingsPanel } from '@/components/client-documents/share/ShareSettingsPanel'
import { CommentComposer } from '@/components/inline-comments/CommentComposer'
import type { AnchorTarget } from '@/components/inline-comments/types'
import type { ClientDocument, ClientDocumentVersion, DocumentComment } from '@/lib/client-documents/types'
import type { ContextReference } from '@/lib/context-references/types'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { fmtTimestamp } from '@/lib/format/timestamp'

function ignoreBestEffortFailure() {
  return undefined
}

interface Props {
  params: Promise<{ id: string }>
}

type PendingAnchor =
  | { kind: 'text'; text: string; blockId: string | null }
  | { kind: 'image'; mediaUrl: string; blockId: string | null }
  | { kind: 'general' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canReviewApprovalFromPortalBody(body: Record<string, unknown>) {
  const org = isRecord(body.org) ? body.org : isRecord(body.data) && isRecord(body.data.org) ? body.data.org : {}
  const user = isRecord(body.user) ? body.user : isRecord(body.data) && isRecord(body.data.user) ? body.data.user : {}
  const policies = resolveOrganizationModulePolicies({ modulePolicies: org.modulePolicies })
  const role = user.memberRole ?? user.role
  return canRolePerformModuleAction(policies, 'documents', 'reviewApproval', role)
}

export default function PortalDocumentDetail({ params }: Props) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const portalScope = scopeFromSearchParams(searchParams)
  const documentsHref = scopedPortalPath('/portal/documents', portalScope)
  const orgEndpoint = scopedApiPath('/api/v1/portal/org', portalScope)
  const documentEndpoint = scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}`, portalScope)
  const documentVersionsEndpoint = scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/versions`, portalScope)
  const documentCommentsEndpoint = scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/comments`, portalScope)
  const documentAccessLogEndpoint = scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/access-log`, portalScope)
  const documentExportPdfEndpoint = scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/export-pdf`, portalScope)
  const [doc, setDoc] = useState<ClientDocument | null>(null)
  const [version, setVersion] = useState<ClientDocumentVersion | null>(null)
  const [comments, setComments] = useState<DocumentComment[]>([])
  const [loading, setLoading] = useState(true)
  const [canReviewApproval, setCanReviewApproval] = useState(true)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)

  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null)
  const [composerBusy, setComposerBusy] = useState(false)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [accessLog, setAccessLog] = useState<Array<{ userId: string; accessedAt: unknown; id: string }>>([]);
  const [firebaseUid, setFirebaseUid] = useState('')
  const [firebaseDisplayName, setFirebaseDisplayName] = useState('')

  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUid(user?.uid ?? '')
      setFirebaseDisplayName(user?.displayName ?? user?.email ?? 'Anonymous')
    })
    return unsubscribe
  }, [])

  const articleScrollRef = useRef<HTMLDivElement>(null)

  const refreshComments = useCallback(async () => {
    try {
      const res = await fetch(documentCommentsEndpoint)
      if (!res.ok) return
      const body = await res.json()
      setComments((body.data ?? []) as DocumentComment[])
    } catch { ignoreBestEffortFailure() }
  }, [documentCommentsEndpoint])

  const reloadDocAndVersion = useCallback(async () => {
    try {
      const [docRes, versionsRes] = await Promise.all([
        fetch(documentEndpoint),
        fetch(documentVersionsEndpoint),
      ])
      const docData = await docRes.json()
      const versionsData = await versionsRes.json()
      const document: ClientDocument = docData.data ?? docData
      setDoc(document)
      const versions: ClientDocumentVersion[] = versionsData.data ?? []
      const current =
        versions.find((v) => v.id === document.currentVersionId) ??
        versions.find((v) => v.status === 'published') ??
        versions[versions.length - 1] ??
        null
      setVersion(current)
    } catch { ignoreBestEffortFailure() }
  }, [documentEndpoint, documentVersionsEndpoint])

  useEffect(() => {
    async function load() {
      try {
        const orgPolicyRequest = fetch(orgEndpoint)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
        const [docRes, versionsRes, commentsRes, orgPolicyBody] = await Promise.all([
          fetch(documentEndpoint),
          fetch(documentVersionsEndpoint),
          fetch(documentCommentsEndpoint),
          orgPolicyRequest,
        ])

        const docData = await docRes.json()
        const versionsData = await versionsRes.json()
        const commentsData = await commentsRes.json()
        if (isRecord(orgPolicyBody)) {
          setCanReviewApproval(canReviewApprovalFromPortalBody(orgPolicyBody))
        }

        const document: ClientDocument = docData.data ?? docData
        setDoc(document)
        setComments((commentsData.data ?? []) as DocumentComment[])

        const versions: ClientDocumentVersion[] = versionsData.data ?? []
        const current =
          versions.find((v) => v.id === document.currentVersionId) ??
          versions.find((v) => v.status === 'published') ??
          versions[versions.length - 1] ??
          null
        setVersion(current)

        // Log this access and fetch the recent access log
        void fetch(documentAccessLogEndpoint, { method: 'POST' })
        const logRes = await fetch(documentAccessLogEndpoint)
        if (logRes.ok) {
          const logBody = await logRes.json()
          setAccessLog(logBody.data?.events ?? [])
        }
      } catch { ignoreBestEffortFailure() } finally {
        setLoading(false)
      }
    }
    load()
  }, [documentAccessLogEndpoint, documentCommentsEndpoint, documentEndpoint, documentVersionsEndpoint, orgEndpoint])

  async function handleExportPdf() {
    if (!doc || exportingPdf) return
    setExportingPdf(true)
    try {
      const res = await fetch(documentExportPdfEndpoint)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${doc.title ?? 'document'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch { ignoreBestEffortFailure() } finally {
      setExportingPdf(false)
    }
  }

  const handleRequestTextComment = useCallback((anchor: { text: string; blockId: string | null }) => {
    setPendingAnchor({ kind: 'text', text: anchor.text, blockId: anchor.blockId })
  }, [])

  const handleRequestImageComment = useCallback((anchor: { mediaUrl: string; blockId: string | null }) => {
    setPendingAnchor({ kind: 'image', mediaUrl: anchor.mediaUrl, blockId: anchor.blockId })
  }, [])

  const handleScrollToComment = useCallback((commentId: string) => {
    const c = comments.find((x) => x.id === commentId)
    if (!c) return
    setActiveCommentId(commentId)
    if (c.blockId) {
      const el = globalThis.document.getElementById(`block-${c.blockId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.setTimeout(() => setActiveCommentId(null), 2500)
  }, [comments])

  async function submitComposer(text: string, contextRefs: ContextReference[], alsoLinkToDocument?: boolean) {
    if (!pendingAnchor) return
    setComposerBusy(true)
    try {
      const payload: Record<string, unknown> = { text }
      if (pendingAnchor.kind === 'text') {
        payload.anchor = { type: 'text', text: pendingAnchor.text }
        if (pendingAnchor.blockId) payload.blockId = pendingAnchor.blockId
      } else if (pendingAnchor.kind === 'image') {
        payload.anchor = { type: 'image', mediaUrl: pendingAnchor.mediaUrl }
        if (pendingAnchor.blockId) payload.blockId = pendingAnchor.blockId
      }
      if (version) payload.versionId = version.id
      if (contextRefs.length > 0) payload.contextRefs = contextRefs
      if (alsoLinkToDocument) payload.alsoLinkToDocument = true

      const res = await fetch(documentCommentsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setPendingAnchor(null)
        await refreshComments()
      }
    } finally {
      setComposerBusy(false)
    }
  }

  async function handleResolve(commentId: string, resolved: boolean) {
    const res = await fetch(scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/resolve`, portalScope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved }),
    })
    if (res.ok) await refreshComments()
  }

  async function handleReply(commentId: string, text: string, contextRefs: ContextReference[], alsoLinkToDocument?: boolean) {
    const res = await fetch(scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/replies`, portalScope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(contextRefs.length > 0 ? { contextRefs } : {}),
        ...(alsoLinkToDocument ? { alsoLinkToDocument: true } : {}),
      }),
    })
    if (res.ok) await refreshComments()
  }

  async function handleApprove() {
    if (!doc || !canReviewApproval) return
    if (doc.approvalMode === 'formal_acceptance') {
      setShowApproveModal(true)
      return
    }
    setApproving(true)
    try {
      await fetch(scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/approve`, portalScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setApproved(true)
      setDoc((prev) => prev ? { ...prev, status: 'approved' } : prev)
    } finally {
      setApproving(false)
    }
  }

  async function handleFormalAccept() {
    if (!typedName.trim() || !agreed || approving || !canReviewApproval) return
    setApproving(true)
    try {
      await fetch(scopedApiPath(`/api/v1/client-documents/${encodeURIComponent(id)}/accept`, portalScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typedName: typedName.trim(),
          checkboxText: 'I have read and agree to the terms above',
        }),
      })
      setApproved(true)
      setShowApproveModal(false)
      setDoc((prev) => prev ? { ...prev, status: 'accepted' } : prev)
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="pib-skeleton h-8 w-32" />
        <div className="pib-skeleton h-64" />
        <div className="pib-skeleton h-40" />
      </div>
    )
  }

  if (!doc || !version) {
    return (
      <div className="space-y-6">
        <Link href={documentsHref} className="flex items-center gap-1 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)]">
          <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>
          Back to Documents
        </Link>
        <div className="bento-card p-10 text-center">
          <h2 className="font-display text-2xl">Document not found.</h2>
        </div>
      </div>
    )
  }

  const canComment = doc.clientPermissions.canComment
  const canApprove = canReviewApproval && doc.clientPermissions.canApprove && doc.status === 'client_review' && !approved

  const composerAnchor: AnchorTarget | null = !pendingAnchor
    ? null
    : pendingAnchor.kind === 'text'
      ? { kind: 'text', text: pendingAnchor.text }
      : pendingAnchor.kind === 'image'
        ? { kind: 'image', mediaUrl: pendingAnchor.mediaUrl }
        : { kind: 'general' }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={documentsHref}
          className="flex items-center gap-1 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)]"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>
          Back to Documents
        </Link>
        <div className="flex items-center gap-3">
          {(doc as { signedByExternal?: { signerName?: string } }).signedByExternal && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">verified</span>
              Signed
            </span>
          )}
          {firebaseUid && (
            <DocumentPresence
              documentId={id}
              currentUserId={firebaseUid}
              currentUserName={firebaseDisplayName}
              surfaceRef={articleScrollRef}
            />
          )}
          <button
            type="button"
            onClick={() => setShowVersionHistory(true)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">history</span>
            Version history
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div ref={articleScrollRef} className="min-w-0 rounded-xl overflow-hidden">
          <DocumentRenderer
            document={doc}
            version={version}
            comments={comments}
            onRequestTextComment={canComment ? handleRequestTextComment : undefined}
            onRequestImageComment={canComment ? handleRequestImageComment : undefined}
            onMarkerClick={(id) => {
              setActiveCommentId(id)
              window.setTimeout(() => setActiveCommentId(null), 2500)
            }}
          />
        </div>

        <div className="space-y-4">
          {doc.shareToken && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowShare((v) => !v)}
                className="flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">share</span>
                {showShare ? 'Hide share' : 'Share'}
              </button>
            </div>
          )}

          {showShare && doc.shareToken && baseUrl && (
            <ShareSettingsPanel
              document={doc}
              baseUrl={baseUrl}
              onChange={(next) => setDoc(next)}
            />
          )}

          {/* PDF Export — US-174 */}
          <div className="pib-card p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-[var(--color-pib-text)]">Export document</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Download as PDF</p>
            </div>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              className="flex items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">download</span>
              {exportingPdf ? 'Generating…' : 'PDF'}
            </button>
          </div>

          {/* E-signature — US-172 */}
          <SignatureRequestPanel
            documentId={id}
            canRequest={Boolean(doc.latestPublishedVersionId) && doc.shareEnabled === true}
          />

          <DocumentReviewRail
            document={doc}
            comments={comments}
            activeCommentId={activeCommentId}
            onResolve={handleResolve}
            onReply={handleReply}
            onScrollToComment={handleScrollToComment}
          />

          {/* Recent views — US-188 */}
          {accessLog.length > 0 && (
            <section className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)]">Recent views</h3>
              {accessLog.slice(0, 5).map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
                  <span className="material-symbols-outlined text-sm">person</span>
                  <span>{fmtTimestamp(entry.accessedAt)}</span>
                </div>
              ))}
            </section>
          )}

          {/* Action items — US-215 */}
          <DocumentTaskList documentId={id} />

          {canComment && (
            <div className="pib-card p-4 space-y-3">
              <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">General note</p>
              <button
                type="button"
                onClick={() => setPendingAnchor({ kind: 'general' })}
                className="w-full rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
              >
                Leave a general comment
              </button>
            </div>
          )}

          {canApprove && (
            <div className="pib-card p-4">
              <button
                type="button"
                onClick={handleApprove}
                disabled={approving}
                className="w-full rounded-md px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--color-pib-accent)', color: '#000' }}
              >
                {approving ? 'Approving…' : 'Approve Document'}
              </button>
            </div>
          )}

          {approved && (
            <div className="pib-card p-4 text-center">
              <span className="material-symbols-outlined text-2xl text-green-400">check_circle</span>
              <p className="mt-1 text-sm font-medium">Document approved — thank you!</p>
            </div>
          )}
        </div>
      </div>

      {pendingAnchor && composerAnchor && (
        <CommentComposer
          anchor={composerAnchor}
          orgId={doc.orgId}
          onCancel={() => setPendingAnchor(null)}
          onSubmit={submitComposer}
          busy={composerBusy}
        />
      )}

      {showVersionHistory && version && (
        <VersionHistoryDrawer
          documentId={id}
          currentVersionId={version.id}
          onClose={() => setShowVersionHistory(false)}
          onRestored={() => {
            setShowVersionHistory(false)
            void reloadDocAndVersion()
          }}
        />
      )}

      {showApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="pib-card w-full max-w-md space-y-4 p-6">
            <h2 className="font-display text-xl">Formal acceptance</h2>
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              By signing below, you confirm that you have read and accept the document in full.
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 accent-[var(--color-pib-accent)]"
              />
              <span className="text-sm">I have read and agree to the terms above</span>
            </label>
            <div className="space-y-1">
              <label className="text-xs text-[var(--color-pib-text-muted)]">Type your full name to confirm</label>
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Your full name"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowApproveModal(false)}
                className="flex-1 rounded-md border border-white/10 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFormalAccept}
                disabled={!agreed || !typedName.trim() || approving}
                className="flex-1 rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--color-pib-accent)', color: '#000' }}
              >
                {approving ? 'Submitting…' : 'Accept document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
