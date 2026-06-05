'use client'

export const dynamic = 'force-dynamic'

import { useRouter, useSearchParams } from 'next/navigation'
import { MailboxWorkspace } from '@/components/mailbox/MailboxWorkspace'

export default function AdminMailboxPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const compact = searchParams.get('compact') === '1'

  function closeMailboxPage() {
    if (window.history.length > 1) {
      router.back()
      return
    }
    router.push('/admin/dashboard')
  }

  return (
    <MailboxWorkspace
      surface="admin"
      showCloseAction={!compact}
      onClose={closeMailboxPage}
    />
  )
}
