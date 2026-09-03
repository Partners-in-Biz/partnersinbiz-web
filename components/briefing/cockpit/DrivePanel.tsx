'use client'
import { driveFileUrl } from './googleDeepLinks'
import type { DriveFile } from './useRecentDrive'
import { Icon } from '@/components/studio'

type Props = {
  status: 'connected' | 'not_connected' | 'needs_reconnect'
  files: DriveFile[]
  loading: boolean
}

function mimeIcon(mimeType: string): string {
  if (mimeType.includes('document')) return 'description'
  if (mimeType.includes('spreadsheet')) return 'table_chart'
  if (mimeType.includes('presentation')) return 'slideshow'
  if (mimeType.includes('pdf')) return 'picture_as_pdf'
  return 'insert_drive_file'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function DrivePanel({ status, files, loading }: Props) {
  if (loading) {
    return <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading Drive&hellip;</div>
  }
  if (status === 'needs_reconnect') {
    return (
      <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">
        Reconnect Google to enable Drive.{' '}
        <a
          href="/api/v1/portal/email/google/authorize?scope=workspace&returnTo=/portal/briefings"
          className="text-[var(--color-pib-accent)] hover:underline"
        >
          Reconnect
        </a>
      </div>
    )
  }
  if (status === 'not_connected') {
    return (
      <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">
        No Google account connected.{' '}
        <a
          href="/api/v1/portal/email/google/authorize?scope=workspace&returnTo=/portal/briefings"
          className="text-[var(--color-pib-accent)] hover:underline"
        >
          Connect Google
        </a>
      </div>
    )
  }
  if (files.length === 0) {
    return <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">No recent files.</div>
  }

  return (
    <div className="flex flex-col gap-1.5 p-2">
      {files.map((f) => (
        <a
          key={f.id}
          href={driveFileUrl(f)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2 transition-colors hover:bg-[var(--color-card-hover)]"
        >
          <span aria-hidden="true" className="shrink-0">
            <Icon name={mimeIcon(f.mimeType)} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-[var(--color-pib-text)]">{f.name}</div>
            <div className="text-[10px] text-[var(--color-pib-text-muted)]">
              {timeAgo(f.modifiedTime)}
              {f.owner ? ` · ${f.owner}` : ''}
            </div>
          </div>
          {f.shared && (
            <span className="pib-pill pib-pill-cyan shrink-0 !py-0 !px-1.5 !text-[9px]">
              shared
            </span>
          )}
        </a>
      ))}
    </div>
  )
}
