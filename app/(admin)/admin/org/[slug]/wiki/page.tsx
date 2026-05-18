'use client'

import { useParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'

export default function ClientWikiPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  return (
    <OrgThemedFrame orgId={null} className="-m-6 min-h-screen p-6">
      <KnowledgeBrowser
        scope="agent"
        agent={slug}
        eyebrow="Client workspace"
        title="Client Wiki"
        description="The client-specific Markdown wiki from the shared Obsidian vault. Updates here are saved back to the Hermes knowledge vault for agents and Obsidian to pick up."
      />
    </OrgThemedFrame>
  )
}
