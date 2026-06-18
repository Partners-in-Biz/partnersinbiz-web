'use client'
import { driveFileUrl } from './googleDeepLinks'
import type { DriveFile } from './useRecentDrive'

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
    return <div className="p-4 text-sm text-on-surface-variant">Loading Drive&hellip;</div>
  }
  if (status === 'needs_reconnect') {
    return (
      <div className="p-4 text-sm text-on-surface-variant">
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
      <div className="p-4 text-sm text-on-surface-variant">
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
    return <div className="p-4 text-sm text-on-surface-variant">No recent files.</div>
  }

  return (
    <div className="flex flex-col gap-1.5 p-2">
      {files.map((f) => (
        <a
          key={f.id}
          href={driveFileUrl(f)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-2 transition-colors hover:bg-[var(--color-card-hover)]"
        >
          <span
            className="material-symbols-outlined shrink-0 text-[18px] text-on-surface-variant"
            aria-hidden="true"
          >
            {mimeIcon(f.mimeType)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-on-surface">{f.name}</div>
            <div className="text-[10px] text-on-surface-variant">
              {timeAgo(f.modifiedTime)}
              {f.owner ? ` · ${f.owner}` : ''}
            </div>
          </div>
          {f.shared && (
            <span className="shrink-0 rounded bg-blue-500/20 px-1 text-[9px] font-medium text-blue-400">
              shared
            </span>
          )}
        </a>
      ))}
    </div>
  )
}
