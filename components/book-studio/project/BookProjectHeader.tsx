'use client'

import { useState } from 'react'
import { PageHeader, StatusPill, Surface } from '@/components/ui/AppFoundation'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { transitionBookStudioProject, type BookStudioSurface } from '@/lib/book-studio/client'
import { humanizeToken, type BookProject } from './types'

// Mirrors lib/book-studio/lifecycle.ts TRANSITIONS  -  kept as a small local
// copy since this is a client component and lib/book-studio/lifecycle.ts
// pulls in firebase-admin/firestore (server-only) via executeLifecycleTransition.
// If lifecycle.ts is later split into a server-only file + a shared pure
// types/graph file, switch this back to importing TRANSITIONS directly.
const CLIENT_LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  draft: ['content_complete'],
  content_complete: ['rights_cleared', 'draft'],
  rights_cleared: ['assembled', 'draft'],
  assembled: ['qa_approved', 'draft'],
  qa_approved: ['submission_ready', 'draft'],
  submission_ready: ['submitted', 'draft'],
  submitted: ['live', 'draft'],
  live: ['archived', 'draft'],
  archived: ['draft'],
}

type BookProjectHeaderProps = {
  project: BookProject
  orgId: string
  onOpenInCanvas: () => void
  openingCanvas: boolean
  onAssemble: () => void
  assembling: boolean
  showOperatorActions?: boolean
  onRequestDraft?: () => void
  requestingDraft?: boolean
  /** 'admin' calls the admin transition endpoint, 'portal' calls the portal one. */
  surface?: BookStudioSurface
  /** Fired after a successful transition so the parent can reload the project. */
  onTransitioned?: (result: { from: string; to: string }) => void
}

function statusTone(status?: string): 'rose' | 'accent' | 'success' | 'warn' | 'danger' | 'info' {
  if (status === 'approved') return 'success'
  if (status === 'blocked') return 'danger'
  if (status === 'internal_review' || status === 'client_review' || status === 'needs_review') return 'warn'
  return 'rose'
}

function lifecycleTone(state: string): 'rose' | 'accent' | 'success' | 'warn' | 'danger' | 'info' {
  if (state === 'live') return 'success'
  if (state === 'archived') return 'rose'
  if (state === 'draft') return 'rose'
  return 'accent'
}

export function BookProjectHeader({
  project,
  orgId,
  onOpenInCanvas,
  openingCanvas,
  onAssemble,
  assembling,
  showOperatorActions = true,
  onRequestDraft,
  requestingDraft = false,
  surface = 'admin',
  onTransitioned,
}: BookProjectHeaderProps) {
  const [transitioningTo, setTransitioningTo] = useState<string | null>(null)
  const [transitionError, setTransitionError] = useState('')
  const [transitionBlockers, setTransitionBlockers] = useState<string[]>([])

  const format = project.format ? getBookFormat(project.format) : null
  const trimLabel = project.trim?.presetId ? project.trim.presetId : format?.defaultTrim
  const lifecycleState = project.lifecycleState ?? 'draft'
  const allowedTransitions = CLIENT_LIFECYCLE_TRANSITIONS[lifecycleState] ?? []

  async function handleTransition(toState: string) {
    setTransitioningTo(toState)
    setTransitionError('')
    setTransitionBlockers([])
    try {
      const result = await transitionBookStudioProject(project.id, orgId, toState, undefined, surface)
      if (!result.ok) {
        setTransitionError(result.error)
        const blockers = result.extra?.blockers
        setTransitionBlockers(Array.isArray(blockers) ? blockers.filter((b): b is string => typeof b === 'string') : [])
        return
      }
      onTransitioned?.(result.data)
    } finally {
      setTransitioningTo(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        accent="rose"
        eyebrow="Book Studio · Project workspace"
        title={project.title ?? 'Untitled book project'}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {project.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={project.coverImageUrl}
                alt="Cover thumbnail"
                className="h-10 w-8 rounded-md border border-[var(--color-pib-border)] object-cover"
              />
            ) : null}
            {format ? <StatusPill tone="rose">{format.label}</StatusPill> : null}
            {trimLabel ? <StatusPill tone="rose">{trimLabel}</StatusPill> : null}
            <StatusPill tone={lifecycleTone(lifecycleState)}>{humanizeToken(lifecycleState)}</StatusPill>
            {project.status ? <StatusPill tone={statusTone(project.status)}>{humanizeToken(project.status)}</StatusPill> : null}
            {project.stage ? <StatusPill tone="rose">{humanizeToken(project.stage)}</StatusPill> : null}
            {project.seriesVolumeNumber ? (
              <StatusPill tone="accent">Volume {project.seriesVolumeNumber}</StatusPill>
            ) : null}
            {project.creativeCanvasId ? (
              <a
                href={`/admin/creative-canvas?canvas=${encodeURIComponent(project.creativeCanvasId)}`}
                className="pib-pill"
              >
                Canvas ↗
              </a>
            ) : null}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {showOperatorActions ? (
              <>
                <button type="button" className="btn-pib-secondary btn-pib-sm font-label" disabled={openingCanvas} onClick={onOpenInCanvas}>
                  {openingCanvas ? 'Opening…' : 'Open in canvas'}
                </button>
                <button type="button" className="btn-pib-primary btn-pib-sm font-label" disabled={assembling} onClick={onAssemble}>
                  {assembling ? 'Assembling…' : 'Assemble book'}
                </button>
              </>
            ) : onRequestDraft ? (
              <button type="button" className="btn-pib-primary btn-pib-sm font-label" disabled={requestingDraft} onClick={onRequestDraft}>
                {requestingDraft ? 'Requesting…' : 'Request AI draft'}
              </button>
            ) : null}
            {allowedTransitions.map((toState) => (
              <button
                key={toState}
                type="button"
                className="btn-pib-secondary btn-pib-sm font-label"
                disabled={transitioningTo !== null}
                onClick={() => handleTransition(toState)}
              >
                {transitioningTo === toState ? 'Working…' : `Move to ${humanizeToken(toState)}`}
              </button>
            ))}
          </div>
        }
      />
      {transitionError ? (
        <Surface role="alert" className="border-red-200 bg-red-50 text-red-900">
          <p>{transitionError}</p>
          {transitionBlockers.length ? (
            <ul className="mt-1 list-disc pl-5">
              {transitionBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
        </Surface>
      ) : null}
    </div>
  )
}
