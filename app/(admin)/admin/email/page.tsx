// app/(admin)/admin/email/page.tsx
'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { EmailList, type EmailFolder } from '@/components/admin/email/EmailList'
import { EmailDetail } from '@/components/admin/email/EmailDetail'

const FOLDER_STATUS: Record<EmailFolder, string> = {
  sent: 'sent',
  scheduled: 'scheduled',
  drafts: 'draft',
  failed: 'failed',
}

interface EmailRow {
  id: string
  to: string
  subject: string
  status: string
  sentAt: unknown
  scheduledFor: unknown
  createdAt: unknown
  from: string
  cc: string[]
  bodyHtml: string
  bodyText: string
}

export default function EmailInboxPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [folder, setFolder] = useState<EmailFolder>(
    (searchParams.get('folder') as EmailFolder) ?? 'sent'
  )
  const [emails, setEmails] = useState<EmailRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailEmail, setDetailEmail] = useState<EmailRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchEmails = useCallback(async () => {
    setListLoading(true)
    setSelectedId(null)
    setDetailEmail(null)
    const status = FOLDER_STATUS[folder]
    const res = await fetch(`/api/v1/email?status=${status}&limit=100`)
    const body = await res.json()
    setEmails(body.data ?? [])
    setListLoading(false)
  }, [folder])

  useEffect(() => { fetchEmails() }, [fetchEmails])

  async function handleSelect(id: string) {
    setSelectedId(id)
    setDetailLoading(true)
    const found = emails.find((e) => e.id === id) ?? null
    setDetailEmail(found)
    setDetailLoading(false)
  }

  return (
    <div className="flex h-full -m-6 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3">
        <div>
          <p className="eyebrow">Email</p>
          <h1 className="text-xl font-semibold">System emails</h1>
        </div>
        <button type="button" onClick={() => router.push('/admin/email/mailbox')} className="btn-pib-primary">
          <span className="material-symbols-outlined text-[18px]">mail</span>
          Open internal mailbox
        </button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <EmailList
        folder={folder}
        emails={emails}
        loading={listLoading}
        selectedId={selectedId}
        onSelect={handleSelect}
        onFolderChange={(f) => {
            setFolder(f)
            router.push(`?folder=${f}`)
          }}
      />
      <EmailDetail email={detailEmail} loading={detailLoading} />
      </div>
    </div>
  )
}
