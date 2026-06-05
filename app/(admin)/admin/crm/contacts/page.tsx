'use client'

import { ContactsWorkspace } from '@/components/crm/ContactsWorkspace'

export const dynamic = 'force-dynamic'

export default function AdminContactsPage() {
  return <ContactsWorkspace mode="admin" />
}
