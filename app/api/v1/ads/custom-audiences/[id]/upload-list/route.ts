// app/api/v1/ads/custom-audiences/[id]/upload-list/route.ts
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCustomAudience, updateCustomAudience } from '@/lib/ads/custom-audiences/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { logCustomAudienceActivity } from '@/lib/ads/activity'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

/** Lowercase + trim + SHA-256 hex hash per Meta spec. */
function hashField(raw: string): string {
  return crypto.createHash('sha256').update(raw.toLowerCase().trim()).digest('hex')
}

const BATCH_SIZE = 10000 // Meta supports up to 10k per request
const VALID_COLUMNS = ['EMAIL', 'PHONE'] as const

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const { id } = await ctxParams.params
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const ca = await getCustomAudience(id)
    if (!ca || ca.orgId !== orgId) return apiError('Custom audience not found', 404)
    if (ca.type !== 'CUSTOMER_LIST') return apiError('Only CUSTOMER_LIST audiences support upload-list', 400)

    // Parse multipart form (shared across platforms)
    const form = await req.formData()
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
        'source.hashCount': uploadResult.totalMembers,
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
