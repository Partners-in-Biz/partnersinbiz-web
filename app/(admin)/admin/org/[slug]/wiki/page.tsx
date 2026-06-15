'use client'

import { useParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'

export default function OrgWikiPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  return (
    <OrgThemedFrame orgId={null} className="-m-6 min-h-screen p-6">
      <KnowledgeBrowser
        scope="agent"
        agent={slug}
        eyebrow="Internal agent knowledge base"
        title="Operator Wiki"
        description="Internal agent knowledge base for this selected organisation. Updates are saved to the Hermes knowledge vault for agents and Obsidian; this is not a client-facing approval or publishing surface."
      />
    </OrgThemedFrame>
  )
}
