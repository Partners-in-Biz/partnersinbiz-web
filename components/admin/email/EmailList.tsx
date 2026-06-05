// components/admin/email/EmailList.tsx
'use client'
import Link from 'next/link'
import { fmtTimestamp } from '@/lib/format/timestamp'

export type EmailFolder = 'sent' | 'scheduled' | 'drafts' | 'failed'

const FOLDERS: { label: string; value: EmailFolder; status: string }[] = [
  { label: 'Sent',      value: 'sent',      status: 'sent'      },
  { label: 'Scheduled', value: 'scheduled', status: 'scheduled' },
  { label: 'Drafts',    value: 'drafts',    status: 'draft'     },
  { label: 'Failed',    value: 'failed',    status: 'failed'    },
]

interface EmailRow {
  id: string
  to: string
  subject: string
  status: string
  sentAt: unknown
  scheduledFor: unknown
  createdAt: unknown
}

interface EmailListProps {
  folder: EmailFolder
  emails: EmailRow[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onFolderChange: (f: EmailFolder) => void
}

export function EmailList({
  folder,
  emails,
  loading,
  selectedId,
  onSelect,
  onFolderChange,
}: EmailListProps) {
  return (
    <div className="flex flex-col h-full border-r border-outline-variant w-72 shrink-0">
      {/* Folder tabs */}
      <div className="border-b border-outline-variant">
        {FOLDERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onFolderChange(f.value)}
            className={`w-full text-left px-4 py-2.5 text-sm font-label transition-colors ${
              folder === f.value
                ? 'text-on-surface bg-surface-container'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Compose button */}
      <div className="px-4 py-3 border-b border-outline-variant">
        <Link
          href="/admin/email/compose"
          className="block w-full text-center py-2 text-sm font-label text-black bg-on-surface hover:opacity-90 transition-opacity"
        >
          + Compose
        </Link>
      </div>

      {/* Email rows */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 bg-surface-container animate-pulse" />
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-on-surface-variant text-sm mb-3">No emails here.</p>
            <Link href="/admin/email/compose" className="text-sm text-on-surface underline">
              Compose your first email →
            </Link>
          </div>
        ) : (
          emails.map((email) => (
            <button
              key={email.id}
              onClick={() => onSelect(email.id)}
              className={`w-full text-left px-4 py-3 border-b border-outline-variant transition-colors ${
                selectedId === email.id
                  ? 'bg-surface-container'
                  : 'hover:bg-surface-container'
              }`}
            >
              <p className="text-sm text-on-surface font-medium truncate">{email.subject || '(no subject)'}</p>
              <p className="text-xs text-on-surface-variant truncate mt-0.5">{email.to}</p>
              <p className="text-[10px] text-on-surface-variant mt-0.5">
                {fmtTimestamp(
                  folder === 'sent' ? email.sentAt :
                  folder === 'scheduled' ? email.scheduledFor :
                  email.createdAt
                )}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
