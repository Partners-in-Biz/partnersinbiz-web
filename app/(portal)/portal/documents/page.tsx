'use client'
export const dynamic = 'force-dynamic'

import { ClientDocumentsWorkspace } from '@/components/client-documents/ClientDocumentsWorkspace'

export default function PortalDocuments() {
  return <ClientDocumentsWorkspace surface="portal" />
}
