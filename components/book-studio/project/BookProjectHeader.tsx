'use client'

import { PageHeader, StatusPill } from '@/components/ui/AppFoundation'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { humanizeToken, type BookProject } from './types'

type BookProjectHeaderProps = {
  project: BookProject
  onOpenInCanvas: () => void
  openingCanvas: boolean
  onAssemble: () => void
  assembling: boolean
}

function statusTone(status?: string): 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info' {
  if (status === 'approved') return 'success'
  if (status === 'blocked') return 'danger'
  if (status === 'internal_review' || status === 'client_review' || status === 'needs_review') return 'warn'
  return 'neutral'
}

export function BookProjectHeader({ project, onOpenInCanvas, openingCanvas, onAssemble, assembling }: BookProjectHeaderProps) {
  const format = project.format ? getBookFormat(project.format) : null
  const trimLabel = project.trim?.presetId ? project.trim.presetId : format?.defaultTrim

  return (
    <PageHeader
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
          {format ? <StatusPill tone="neutral">{format.label}</StatusPill> : null}
          {trimLabel ? <StatusPill tone="neutral">{trimLabel}</StatusPill> : null}
          {project.status ? <StatusPill tone={statusTone(project.status)}>{humanizeToken(project.status)}</StatusPill> : null}
          {project.stage ? <StatusPill tone="neutral">{humanizeToken(project.stage)}</StatusPill> : null}
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
        <>
          <button type="button" className="btn-secondary" disabled={openingCanvas} onClick={onOpenInCanvas}>
            {openingCanvas ? 'Opening…' : 'Open in canvas'}
          </button>
          <button type="button" className="btn-primary" disabled={assembling} onClick={onAssemble}>
            {assembling ? 'Assembling…' : 'Assemble book'}
          </button>
        </>
      }
    />
  )
}
