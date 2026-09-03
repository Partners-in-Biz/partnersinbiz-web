// app/(admin)/admin/agents/page.tsx
// Auth is handled by the (admin) layout - no additional check needed here.

import AgentsBoardClient from './AgentsBoardClient'

export const dynamic = 'force-dynamic'

export default function AgentsPage() {
  return <AgentsBoardClient />
}
