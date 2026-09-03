import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  getRuntimeChannelsDocument,
  parseRuntimeChannelsDocument,
  writeRuntimeChannelsDocument,
} from '@/lib/linked-computers/runtime-config'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const channels = await getRuntimeChannelsDocument()
  return apiSuccess(channels)
})

export const PUT = withAuth('admin', async (req: NextRequest) => {
  const body: unknown = await req.json().catch(() => null)
  const parsed = parseRuntimeChannelsDocument(body)
  if (!parsed) return apiError('Invalid runtime channel configuration', 400)
  const saved = await writeRuntimeChannelsDocument(parsed)
  return apiSuccess(saved)
})
