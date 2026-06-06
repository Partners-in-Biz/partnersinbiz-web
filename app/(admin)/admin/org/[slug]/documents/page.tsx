'use client'

import { useParams } from 'next/navigation'
import { ClientDocumentsWorkspace } from '@/components/client-documents/ClientDocumentsWorkspace'

function routeParamSlug(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default function OrgDocumentsPage() {
  const params = useParams<{ slug?: string | string[] }>()
  const slug = routeParamSlug(params?.slug)

  return <ClientDocumentsWorkspace surface="admin" orgSlug={slug} />
}
