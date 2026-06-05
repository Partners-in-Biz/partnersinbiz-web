'use client'

export const dynamic = 'force-dynamic'

import { MailboxWorkspace } from '@/components/mailbox/MailboxWorkspace'

export default function EmailInboxPage() {
  return <MailboxWorkspace surface="admin" />
}
