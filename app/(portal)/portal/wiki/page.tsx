import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'

export const dynamic = 'force-dynamic'

export default function PortalWikiPage() {
  return (
    <KnowledgeBrowser
      scope="agent"
      apiPath="/api/v1/portal/knowledge"
      readOnly
      sections={['wiki', 'logs']}
      eyebrow="Workspace"
      title="Wiki"
      description="Read-only knowledge notes and activity logs shared with your workspace."
    />
  )
}
