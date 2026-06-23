import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminWikiSyncPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/system/wiki-sync"
      eyebrow="System operations"
      title="Wiki sync"
      summary="Knowledge-base sync evidence, indexed memory rows, reindex handoffs, and recent wiki/Obsidian-related agent work."
    />
  )
}
