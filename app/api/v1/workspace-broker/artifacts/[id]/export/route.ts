import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { brokerArtifactDefaults, loadWorkspaceArtifactForBroker } from '@/lib/workspace-os/artifactRoute'
import { createBrokerJob } from '@/lib/workspace-os/brokerRoute'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadWorkspaceArtifactForBroker(req, user, id)
  if ('response' in loaded) return loaded.response
  return createBrokerJob(req, user, 'export_pdf', brokerArtifactDefaults(loaded.artifact))
})
