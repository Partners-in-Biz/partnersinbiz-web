import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { createBrokerJob } from '@/lib/workspace-os/brokerRoute'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => createBrokerJob(req, user, 'create_doc'))
