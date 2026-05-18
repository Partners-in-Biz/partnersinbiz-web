import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'

export const dynamic = 'force-dynamic'

export default function AdminKnowledgePage() {
  return (
    <KnowledgeBrowser
      scope="shared"
      eyebrow="Admin workspace"
      title="Shared Knowledge"
      description="Internal Markdown knowledge shared across Pip and the wider agent team. These notes are backed by the synced Obsidian vault on the Hermes VPS."
    />
  )
}
