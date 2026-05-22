import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { serializeBlocksForFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION, createClientDocument } from '@/lib/client-documents/store'
import { adminDb } from '@/lib/firebase/admin'
import { blocksFromResearchItem } from '@/lib/research/document'
import {
  getResearchItem,
  listResearchSources,
  updateResearchItem,
} from '@/lib/research/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const item = await getResearchItem(id)
  if (!item) return apiError('Research item not found', 404)
  const scope = resolveOrgScope(user, item.orgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const sources = await listResearchSources(id)
  const created = await createClientDocument({
    orgId: item.orgId,
    title: `${item.title} Research Report`,
    type: 'research_report',
    linked: {
      ...item.linked,
      researchItemIds: [id],
    },
    user,
  })

  const blocks = serializeBlocksForFirestore(blocksFromResearchItem(item, sources))
  await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .doc(created.id)
    .collection('versions')
    .doc(created.versionId)
    .update({
      blocks,
      changeSummary: 'Generated from research item',
    })

  const documentIds = Array.from(new Set([...(item.linked.documentIds ?? []), created.id]))
  await updateResearchItem(id, {
    status: 'used_in_document',
    linked: { ...item.linked, documentIds },
  }, user)

  return apiSuccess({ documentId: created.id, versionId: created.versionId }, 201)
})
