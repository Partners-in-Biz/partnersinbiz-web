'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientDocument, ClientDocumentVersion, DocumentComment } from '@/lib/client-documents/types'
import { DocumentTheme } from './theme/DocumentTheme'
import { getRenderer } from './blocks'
import { useReveal } from './motion/useReveal'
import { useCounter } from './motion/useCounter'
import { SelectionPopover } from '@/components/inline-comments/SelectionPopover'
import { ContextReferenceChips } from '@/components/context-references/ContextReferenceChips'
import { applyInlineMarkers, clearInlineMarkers, findBlockIdForNode } from '@/lib/client-documents/inlineMarkers'

function readableType(type: string) {
  return type.replaceAll('_', ' ')
}

function formatSignatureDate(value: unknown) {
  if (!value) return 'Date pending'
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Date recorded' : date.toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number }
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') {
      const nanos = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0
      const date = new Date(seconds * 1000 + Math.floor(nanos / 1e6))
      return Number.isNaN(date.getTime()) ? 'Date recorded' : date.toLocaleDateString('en-ZA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Date recorded' : date.toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }
  if (
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate()
    return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return 'Date recorded'
}

function AgreementSignatureSection({ document }: { document: ClientDocument }) {
  if (document.approvalMode !== 'formal_acceptance') return null

  const provider = document.providerSignature
  const client = document.clientAcceptance

  return (
    <section className="mt-12 border-t border-[var(--doc-border)] pt-10" aria-labelledby="agreement-signatures">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--doc-muted)]">Formal acceptance</p>
        <h2 id="agreement-signatures" className="mt-2 text-2xl font-semibold text-[var(--doc-text)]">
          Agreement signatures
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--doc-border)] bg-[var(--doc-surface)] p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--doc-muted)]">For Partners in Biz</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-[var(--doc-muted)]">Name</dt>
              <dd className="font-medium text-[var(--doc-text)]">{provider?.name ?? 'Awaiting PiB countersignature'}</dd>
            </div>
            <div>
              <dt className="text-[var(--doc-muted)]">Capacity</dt>
              <dd className="font-medium text-[var(--doc-text)]">{provider?.capacity ?? 'Not signed yet'}</dd>
            </div>
            <div>
              <dt className="text-[var(--doc-muted)]">Company</dt>
              <dd className="font-medium text-[var(--doc-text)]">{provider?.companyName ?? 'The Partners in Business'}</dd>
            </div>
            <div>
              <dt className="text-[var(--doc-muted)]">Signature</dt>
              <dd className="font-medium text-[var(--doc-text)]">
                {provider ? `Signature: ${provider.signatureText}` : 'Pending'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--doc-muted)]">Date</dt>
              <dd className="font-medium text-[var(--doc-text)]">{formatSignatureDate(provider?.signedAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-[var(--doc-border)] bg-[var(--doc-surface)] p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--doc-muted)]">For Client</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-[var(--doc-muted)]">Name</dt>
              <dd className="font-medium text-[var(--doc-text)]">{client?.typedName ?? 'Awaiting client acceptance'}</dd>
            </div>
            <div>
              <dt className="text-[var(--doc-muted)]">Company</dt>
              <dd className="font-medium text-[var(--doc-text)]">{client?.companyName ?? 'Client organisation'}</dd>
            </div>
            <div>
              <dt className="text-[var(--doc-muted)]">Signature</dt>
              <dd className="font-medium text-[var(--doc-text)]">
                {client ? 'Formal electronic acceptance via platform' : 'Pending platform acceptance'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--doc-muted)]">Date</dt>
              <dd className="font-medium text-[var(--doc-text)]">{formatSignatureDate(client?.acceptedAt)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}

export interface DocumentRendererProps {
  document: ClientDocument
  version: ClientDocumentVersion
  comments?: DocumentComment[]
  onRequestTextComment?: (anchor: { text: string; blockId: string | null }) => void
  onRequestImageComment?: (anchor: { mediaUrl: string; blockId: string | null }) => void
  onMarkerClick?: (commentId: string) => void
  showInternalContextRefs?: boolean
}

export function DocumentRenderer({
  document: clientDoc,
  version,
  comments = [],
  onRequestTextComment,
  onRequestImageComment,
  onMarkerClick,
  showInternalContextRefs = false,
}: DocumentRendererProps) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const articleRef = useRef<HTMLElement>(null)
  const visibleBlocks = useMemo(
    () => version.blocks.filter((block) => block.visibility !== 'hidden' && (showInternalContextRefs || block.visibility !== 'internal-only')),
    [showInternalContextRefs, version.blocks],
  )

  useReveal(articleRef, version.id)
  useCounter(articleRef, version.id)

  useEffect(() => {
    const root = articleRef.current
    if (!root) return
    const sections = visibleBlocks
      .map((b) => root.querySelector(`#block-${b.id}`))
      .filter(Boolean) as HTMLElement[]
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const blockId = entry.target.id.replace('block-', '')
            setActiveBlockId(blockId)
          }
        })
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    )

    sections.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [visibleBlocks])

  useEffect(() => {
    function onScroll() {
      const scrolled = window.scrollY
      const total = globalThis.document.body.scrollHeight - window.innerHeight
      setProgress(total > 0 ? (scrolled / total) * 100 : 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const root = articleRef.current
    if (!root) return
    const timer = window.setTimeout(() => {
      applyInlineMarkers(root, comments)
    }, 60)
    return () => {
      window.clearTimeout(timer)
      if (root) clearInlineMarkers(root)
    }
  }, [comments, version.id])

  useEffect(() => {
    const root = articleRef.current
    if (!root) return

    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return

      const mark = target.closest<HTMLElement>('mark[data-doc-comment-id]')
      if (mark) {
        e.preventDefault()
        const id = mark.getAttribute('data-doc-comment-id')
        if (id && onMarkerClick) onMarkerClick(id)
        return
      }

      const imgBadge = target.closest<HTMLElement>('[data-doc-comment-image-badge]')
      if (imgBadge) {
        e.preventDefault()
        const id = imgBadge.getAttribute('data-doc-comment-image-badge')
        if (id && onMarkerClick) onMarkerClick(id)
        return
      }

      const blockBadge = target.closest<HTMLElement>('[data-doc-comment-block-badge]')
      if (blockBadge) {
        const block = blockBadge.closest<HTMLElement>('[id^="block-"]')
        if (block) {
          const blockComments = comments.filter((c) => c.blockId === block.id.slice('block-'.length))
          const firstOpen = blockComments.find((c) => c.status !== 'resolved') ?? blockComments[0]
          if (firstOpen && onMarkerClick) onMarkerClick(firstOpen.id)
        }
        return
      }

      if (onRequestImageComment && target.tagName === 'IMG') {
        const img = target as HTMLImageElement
        const blockId = findBlockIdForNode(img)
        const mediaUrl = img.currentSrc || img.src || img.getAttribute('src') || ''
        if (mediaUrl) {
          e.preventDefault()
          onRequestImageComment({ mediaUrl, blockId })
        }
      }
    }

    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [comments, onMarkerClick, onRequestImageComment])

  function handleSelectionComment(text: string) {
    if (!onRequestTextComment) return
    const sel = window.getSelection()
    const node = sel && !sel.isCollapsed ? sel.getRangeAt(0).startContainer : null
    const blockId = findBlockIdForNode(node)
    onRequestTextComment({ text, blockId })
    sel?.removeAllRanges()
  }

  return (
    <DocumentTheme palette={version.theme?.palette}>
      <div
        className="fixed top-0 left-0 z-50 h-[2px] transition-[width] duration-100"
        style={{ width: `${progress}%`, background: 'var(--doc-accent)' }}
        aria-hidden
      />

      <article ref={articleRef} className="min-h-screen">
        <div className="mx-auto max-w-5xl px-5 py-12 md:px-10 md:py-16">
          <header className="flex min-h-[42vh] flex-col justify-end border-b border-[var(--doc-border)] pb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--doc-muted)]">
              {readableType(clientDoc.type)}
            </p>
            <h1 className="mt-4 max-w-4xl text-5xl font-semibold leading-none md:text-7xl">
              {clientDoc.title}
            </h1>
            <p className="mt-6 text-sm text-[var(--doc-muted)]">
              Version {version.versionNumber}
            </p>
          </header>

          <div className="grid gap-10 md:grid-cols-[1fr_180px]">
            <div>
              {visibleBlocks.map((block, index) => {
                const Renderer = getRenderer(block.type)
                return (
                  <div key={block.id} className="relative">
                    {showInternalContextRefs && block.contextRefs && block.contextRefs.length > 0 ? (
                      <div className="mb-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2" data-testid={`block-context-${block.id}`}>
                        <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-amber-200/80">Internal context</p>
                        <ContextReferenceChips refs={block.contextRefs} compact />
                      </div>
                    ) : null}
                    <Renderer block={block} index={index} />
                  </div>
                )
              })}
              <AgreementSignatureSection document={clientDoc} />
            </div>
            <aside className="hidden pt-10 md:block">
              <nav className="sticky top-24 space-y-1 text-xs text-[var(--doc-muted)]">
                {visibleBlocks.map((block) => {
                  const isActive = activeBlockId === block.id
                  return (
                    <a
                      key={block.id}
                      href={`#block-${block.id}`}
                      className={[
                        'block border-l-2 pl-3 py-0.5 transition-colors duration-200',
                        isActive
                          ? 'border-[var(--doc-accent)] text-[var(--doc-accent)]'
                          : 'border-transparent hover:text-[var(--doc-accent)]',
                      ].join(' ')}
                    >
                      {block.title ?? readableType(block.type)}
                    </a>
                  )
                })}
              </nav>
            </aside>
          </div>
        </div>
      </article>

      {onRequestTextComment && (
        <SelectionPopover containerRef={articleRef} onComment={handleSelectionComment} />
      )}
    </DocumentTheme>
  )
}
