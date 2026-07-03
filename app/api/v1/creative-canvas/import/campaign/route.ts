// app/api/v1/creative-canvas/import/campaign/route.ts
//
// POST { campaignId } → imports a content-engine campaign (blogs, social
// posts, hero images, videos) as a new draft Creative Canvas the team can
// edit. Read-only over the campaign — it is never mutated.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { buildCampaignAssets } from '@/lib/campaigns/assets'
import {
  buildCanvasGraphFromCampaign,
  CampaignImportEmptyError,
} from '@/lib/creative-canvas/importers/campaign'
import {
  createCreativeCanvas,
  updateCreativeCanvasGraph,
} from '@/lib/creative-canvas/store'
import type { CreativeCanvasActor } from '@/lib/creative-canvas/types'

export const dynamic = 'force-dynamic'

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): CreativeCanvasActor {
  return {
    uid: user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)
  const campaignId = typeof (body as Record<string, unknown>).campaignId === 'string'
    ? ((body as Record<string, unknown>).campaignId as string).trim()
    : ''
  if (!campaignId) return apiError('campaignId is required', 400)

  // Org-scoped campaign load — missing, deleted, or foreign campaigns all 404.
  const snap = await adminDb.collection('campaigns').doc(campaignId).get()
  if (!snap.exists) return apiError('Campaign not found', 404)
  const campaign: Record<string, unknown> & { id: string } = { ...(snap.data() as Record<string, unknown>), id: snap.id }
  if (campaign.deleted === true || campaign.orgId !== orgId) {
    return apiError('Campaign not found', 404)
  }

  const assets = await buildCampaignAssets(campaignId)

  let graph
  try {
    graph = buildCanvasGraphFromCampaign(
      campaign as Parameters<typeof buildCanvasGraphFromCampaign>[0],
      assets,
    )
  } catch (error) {
    if (error instanceof CampaignImportEmptyError) {
      return apiError('Campaign has no importable content', 400)
    }
    throw error
  }

  const actor = actorFromUser(user)
  const campaignName = typeof campaign.name === 'string' && campaign.name.trim()
    ? campaign.name.trim()
    : campaignId
  const canvas = await createCreativeCanvas(
    {
      title: `Campaign: ${campaignName}`,
      purpose: `Imported from content-engine campaign ${campaignId} (${campaignName}) as an editable draft.`,
      linked: { campaignId },
    },
    orgId,
    actor,
  )

  await updateCreativeCanvasGraph(
    canvas.id,
    orgId,
    { nodes: graph.nodes, edges: graph.edges },
    actor,
    { expectedActiveVersion: 1, reason: 'campaign_import' },
  )

  return apiSuccess({
    canvasId: canvas.id,
    nodeCount: graph.meta.nodeCount,
    edgeCount: graph.meta.edgeCount,
    capped: graph.meta.capped,
  }, 201)
})
