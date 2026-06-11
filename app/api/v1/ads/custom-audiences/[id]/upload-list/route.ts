// app/api/v1/ads/custom-audiences/[id]/upload-list/route.ts
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { getCustomAudience, updateCustomAudience } from '@/lib/ads/custom-audiences/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { logCustomAudienceActivity } from '@/lib/ads/activity'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getCampaign } from '@/lib/ads/campaigns/store'
import type { ApiUser } from '@/lib/api/types'
import {
  approvalOverrideErrorMessage,
  requireApprovedCampaignForAdsAction,
} from '@/lib/ads/approval-gates'

/** Lowercase + trim + SHA-256 hex hash per Meta spec. */
function hashField(raw: string): string {
  return crypto.createHash('sha256').update(raw.toLowerCase().trim()).digest('hex')
}

const BATCH_SIZE = 10000 // Meta supports up to 10k per request
const VALID_COLUMNS = ['EMAIL', 'PHONE'] as const
const APPROVAL_OVERRIDE_FORM_KEYS = [
  'approvalState',
  'reviewState',
  'approvedAt',
  'approvedBy',
  'approvalHistory',
  'approvalStatus',
]

async function requireAudienceUploadApproval(orgId: string, approvalCampaignId?: string | null) {
  if (!approvalCampaignId) {
    return 'Audience upload requires approvalCampaignId for persisted campaign approval evidence'
  }
  const campaign = await getCampaign(approvalCampaignId)
  if (!campaign || campaign.orgId !== orgId) return 'Campaign not found'
  return requireApprovedCampaignForAdsAction(campaign, 'audience')
}

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctxParams: { params: Promise<{ id: string }> }) => {
    const { id } = await ctxParams.params
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const ca = await getCustomAudience(id)
    if (!ca || ca.orgId !== orgId) return apiError('Custom audience not found', 404)
    if (ca.type !== 'CUSTOMER_LIST') return apiError('Only CUSTOMER_LIST audiences support upload-list', 400)

    // Parse multipart form (shared across platforms)
    const form = await req.formData()
    const approvalOverrideKey = APPROVAL_OVERRIDE_FORM_KEYS.find((key) => form.has(key))
    if (approvalOverrideKey) {
      return apiError(approvalOverrideErrorMessage(`body.${approvalOverrideKey}`), 400)
    }
    const approvalCampaignId = form.get('approvalCampaignId')
    const approvalError = await requireAudienceUploadApproval(
      orgId,
      typeof approvalCampaignId === 'string' ? approvalCampaignId : undefined,
    )
    if (approvalError === 'Campaign not found') return apiError(approvalError, 404)
    if (approvalError) return apiError(approvalError, 403)

    const capabilityError = enforceAgentCapability(user, 'spend', req, {
      approvalCampaignId: typeof approvalCampaignId === 'string' ? approvalCampaignId : undefined,
    })
    if (capabilityError) return capabilityError

    const file = form.get('file')
    const columnsStr = form.get('columns') as string | null
    if (!(file instanceof Blob) || !columnsStr) {
      return apiError('Missing file or columns', 400)
    }
    const columns = JSON.parse(columnsStr) as string[]
    if (
      columns.length === 0 ||
      !columns.every((c) => (VALID_COLUMNS as readonly string[]).includes(c))
    ) {
      return apiError('columns must be a non-empty array of EMAIL and/or PHONE', 400)
    }

    // Parse CSV (basic — assumes no embedded commas/quotes)
    const text = await file.text()
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length < 2) return apiError('CSV must have at least one data row', 400)

    const header = lines[0].split(',').map((h) => h.trim().toUpperCase())
    const columnIndices = columns.map((c) => header.indexOf(c))
    if (columnIndices.some((i) => i === -1)) {
      return apiError(`CSV missing required columns: ${columns.join(', ')}`, 400)
    }

    // ─── LinkedIn branch ──────────────────────────────────────────────────────
    if (ca.platform === 'linkedin') {
      const linkedinData = (ca.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const segmentUrn = typeof linkedinData?.dmpSegmentUrn === 'string' ? linkedinData.dmpSegmentUrn : undefined
      if (!segmentUrn) return apiError('Audience has no LinkedIn dmpSegmentUrn', 400)

      const conn = await getConnection({ orgId, platform: 'linkedin' })
      if (!conn) return apiError('No LinkedIn ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)

      // Parse rows into {email?, phone?} objects
      const emailIdx = header.indexOf('EMAIL')
      const phoneIdx = header.indexOf('PHONE')
      const rows: Array<{ email?: string; phone?: string }> = []
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',')
        const row: { email?: string; phone?: string } = {}
        if (emailIdx !== -1 && cells[emailIdx]?.trim()) row.email = cells[emailIdx].trim()
        if (phoneIdx !== -1 && cells[phoneIdx]?.trim()) row.phone = cells[phoneIdx].trim()
        if (row.email || row.phone) rows.push(row)
      }
      if (rows.length === 0) return apiError('No valid rows found in CSV', 400)

      const { rowToMember, uploadAudienceMembers } = await import('@/lib/ads/providers/linkedin/audiences-hash')
      const members = rows.map((r) => rowToMember({ email: r.email, phone: r.phone }))
      const uploadResult = await uploadAudienceMembers({ accessToken, segmentUrn, members })

      // Update status via store (only mutable fields); update source directly via adminDb
      await updateCustomAudience(id, { status: 'BUILDING' })
      await adminDb.collection('custom_audiences').doc(id).update({
        'source.hashCount': members.length,
        'source.uploadedAt': Timestamp.now(),
        updatedAt: Timestamp.now(),
      })

      const actor = {
        id: (user as { uid?: string }).uid ?? 'unknown',
        name: (user as { email?: string }).email ?? 'Admin',
        role: 'admin' as const,
      }
      await logCustomAudienceActivity({
        orgId,
        actor,
        action: 'list_uploaded',
        audienceId: id,
        audienceName: ca.name,
        audienceType: ca.type,
      })

      return apiSuccess({
        uploaded: uploadResult.totalMembers,
        chunksFailed: uploadResult.chunksFailed,
        ...(uploadResult.firstError ? { firstError: uploadResult.firstError } : {}),
      })
    }

    // ─── TikTok branch ───────────────────────────────────────────────────────
    if (ca.platform === 'tiktok') {
      const tiktokData = (ca.providerData as Record<string, unknown>)?.tiktok as
        | Record<string, unknown>
        | undefined
      const customAudienceId =
        typeof tiktokData?.customAudienceId === 'string'
          ? tiktokData.customAudienceId
          : undefined
      if (!customAudienceId) return apiError('Audience has no TikTok customAudienceId', 400)

      const emailIdx = header.indexOf('EMAIL')
      const phoneIdx = header.indexOf('PHONE')
      const rows: Array<{ email?: string; phone?: string }> = []
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',')
        const row: { email?: string; phone?: string } = {}
        if (emailIdx !== -1 && cells[emailIdx]?.trim()) row.email = cells[emailIdx].trim()
        if (phoneIdx !== -1 && cells[phoneIdx]?.trim()) row.phone = cells[phoneIdx].trim()
        if (row.email || row.phone) rows.push(row)
      }
      if (rows.length === 0) return apiError('No valid rows found in CSV', 400)

      const { rowsToTiktokPayload } = await import(
        '@/lib/ads/providers/tiktok/audiences-hash'
      )
      const payload = rowsToTiktokPayload(rows)

      const conn = await getConnection({ orgId, platform: 'tiktok' })
      if (!conn) return apiError('No TikTok ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)
      const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as
        | Record<string, unknown>
        | undefined
      const advertiserId =
        typeof tiktokMeta?.selectedAdvertiserId === 'string'
          ? tiktokMeta.selectedAdvertiserId
          : undefined
      if (!advertiserId) return apiError('No advertiserId on TikTok connection', 400)

      const { uploadAudienceFile, applyAudienceFile } = await import(
        '@/lib/ads/providers/tiktok/audiences'
      )
      const uploadResult = await uploadAudienceFile({
        advertiserId,
        accessToken,
        customAudienceId,
        payload,
      })
      await applyAudienceFile({
        advertiserId,
        accessToken,
        customAudienceId,
        filePaths: [uploadResult.filePath],
      })

      await updateCustomAudience(id, { status: 'BUILDING' })
      await adminDb.collection('custom_audiences').doc(id).update({
        'source.hashCount': rows.length,
        'source.uploadedAt': Timestamp.now(),
        updatedAt: Timestamp.now(),
      })

      const actor = {
        id: (user as { uid?: string }).uid ?? 'unknown',
        name: (user as { email?: string }).email ?? 'Admin',
        role: 'admin' as const,
      }
      await logCustomAudienceActivity({
        orgId,
        actor,
        action: 'list_uploaded',
        audienceId: id,
        audienceName: ca.name,
        audienceType: ca.type,
      })

      return apiSuccess({ uploaded: rows.length, filePath: uploadResult.filePath })
    }

    // ─── Meta branch ─────────────────────────────────────────────────────────
    const metaCaId = ca.providerData?.meta?.customAudienceId
    if (!metaCaId) return apiError('Custom audience not yet synced to Meta', 400)

    const ctx = await requireMetaContext(req)
    if (ctx instanceof Response) return ctx

    // Hash rows
    const hashedRows: string[][] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',')
      const hashes = columnIndices.map((ci) => {
        const cell = cells[ci]?.trim() ?? ''
        return cell ? hashField(cell) : ''
      })
      // Skip rows with all-empty fields
      if (hashes.some((h) => h.length > 0)) {
        hashedRows.push(hashes)
      }
    }

    // Chunked upload
    let totalUploaded = 0
    for (let i = 0; i < hashedRows.length; i += BATCH_SIZE) {
      const batch = hashedRows.slice(i, i + BATCH_SIZE)
      const result = await metaProvider.customAudienceCRUD!({
        op: 'upload-users',
        accessToken: ctx.accessToken,
        metaCaId,
        uploadPayload: { schema: columns, hashedRows: batch },
      })
      totalUploaded += (result as { numReceived?: number }).numReceived ?? batch.length
    }

    await updateCustomAudience(id, {
      status: 'BUILDING',
    })

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logCustomAudienceActivity({
      orgId,
      actor,
      action: 'list_uploaded',
      audienceId: id,
      audienceName: ca.name,
      audienceType: ca.type,
    })

    const updated = await getCustomAudience(id)
    return apiSuccess({
      ...updated,
      uploadStats: { rowsHashed: hashedRows.length, totalUploaded },
    })
  },
)
