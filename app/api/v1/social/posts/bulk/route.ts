/**
 * POST /api/v1/social/posts/bulk — Bulk create posts + CSV import
 *
 * Accepts either:
 *   { posts: CreatePostBody[] }          — array of posts (max 50)
 *   multipart/form-data with csv file    — CSV import
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { ACTIVE_PLATFORMS } from '@/lib/social/providers'
import type { SocialPlatformType } from '@/lib/social/providers'
import { validatePostContent } from '@/lib/social/validation'
import { logAudit } from '@/lib/social/audit'
import { emptyApprovalState } from '@/lib/social/approval'
import { resolveWorkScopeFromSearchParams, workScopeFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

const MAX_BULK_POSTS = 50

interface BulkResult {
  index: number
  success: boolean
  id?: string
  error?: string
}

function toProviderPlatform(platform: string): SocialPlatformType | null {
  if (platform === 'x' || platform === 'twitter') return 'twitter'
  const p = platform.toLowerCase() as SocialPlatformType
  return ACTIVE_PLATFORMS.includes(p) ? p : null
}

// ---------------------------------------------------------------------------
// CSV parsing (lightweight, handles quoted fields)
// ---------------------------------------------------------------------------

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const parseRow = (line: string): string[] => {
    const fields: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    fields.push(current.trim())
    return fields
  }

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i])
    if (values.every(v => !v)) continue
    const row: Record<string, string> = {}
    headers.forEach((h, j) => { row[h] = values[j] ?? '' })
    rows.push(row)
  }

  return rows
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const POST = withAuth('admin', withTenant(async (req: NextRequest, user, orgId) => {
  const contentType = req.headers.get('content-type') ?? ''
  const scopeFields = workScopeFieldsForWrite(
    resolveWorkScopeFromSearchParams(new URL(req.url).searchParams, user.uid),
  )

  // CSV import
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('file is required in form data')

    const csvText = await file.text()
    const rows = parseCsv(csvText)
    if (rows.length === 0) return apiError('CSV has no data rows')
    if (rows.length > MAX_BULK_POSTS) return apiError(`CSV exceeds ${MAX_BULK_POSTS} row limit`)

    // Map CSV rows to post bodies
    // Expected columns: content, platforms, scheduled_at, category, hashtags, tags, labels
    const posts = rows.map(row => ({
      content: row.content || row.text || '',
      platforms: (row.platforms || row.platform || 'twitter').split(/[;|]/).map(p => p.trim()).filter(Boolean),
      scheduledAt: row.scheduled_at || row.scheduled_for || null,
      category: row.category || 'other',
      hashtags: row.hashtags ? row.hashtags.split(/[;|]/).map((h: string) => h.trim()).filter(Boolean) : [],
      tags: row.tags ? row.tags.split(/[;|]/).map((t: string) => t.trim()).filter(Boolean) : [],
      labels: row.labels ? row.labels.split(/[;|]/).map((l: string) => l.trim()).filter(Boolean) : [],
    }))

    const results = await createBulkPosts(posts, orgId, user.uid, user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client', req, scopeFields)
    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return apiSuccess({ total: rows.length, succeeded, failed, results })
  }

  // JSON bulk create
  const body = await req.json()
  const posts = body.posts as Array<{
    content: string | { text: string }
    platforms?: string[]
    platform?: string
    scheduledAt?: string
    scheduledFor?: string
    category?: string
    hashtags?: string[]
    tags?: string[]
    labels?: string[]
    accountIds?: string[]
  }>

  if (!Array.isArray(posts) || posts.length === 0) {
    return apiError('posts[] array is required')
  }
  if (posts.length > MAX_BULK_POSTS) {
    return apiError(`Maximum ${MAX_BULK_POSTS} posts per bulk request`)
  }

  const mapped = posts.map(p => ({
    content: typeof p.content === 'string' ? p.content : p.content?.text ?? '',
    platforms: p.platforms ?? (p.platform ? [p.platform] : ['twitter']),
    scheduledAt: p.scheduledAt ?? p.scheduledFor ?? null,
    category: p.category ?? 'other',
    hashtags: p.hashtags ?? [],
    tags: p.tags ?? [],
    labels: p.labels ?? [],
    accountIds: p.accountIds ?? [],
  }))

  const results = await createBulkPosts(mapped, orgId, user.uid, user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client', req, scopeFields)
  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  return apiSuccess({ total: posts.length, succeeded, failed, results })
}))

async function createBulkPosts(
  posts: Array<{
    content: string
    platforms: string[]
    scheduledAt: string | null
    category: string
    hashtags: string[]
    tags: string[]
    labels: string[]
    accountIds?: string[]
  }>,
  orgId: string,
  userId: string,
  role: 'admin' | 'client' | 'ai',
  req: NextRequest,
  scopeFields: Record<string, unknown> = {},
): Promise<BulkResult[]> {
  const results: BulkResult[] = []

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]
    try {
      const contentText = post.content.trim()
      if (!contentText) {
        results.push({ index: i, success: false, error: 'Content is empty' })
        continue
      }

      const platforms: SocialPlatformType[] = []
      for (const p of post.platforms) {
        const pt = toProviderPlatform(p)
        if (!pt) {
          results.push({ index: i, success: false, error: `Unsupported platform: ${p}` })
          break
        }
        platforms.push(pt)
      }
      if (platforms.length !== post.platforms.length) continue

      const validation = validatePostContent(contentText, platforms)
      if (!validation.valid) {
        results.push({ index: i, success: false, error: validation.errors.map(e => e.message).join('; ') })
        continue
      }

      let scheduledAt: Timestamp | null = null
      const status = 'draft'
      if (post.scheduledAt) {
        const d = new Date(post.scheduledAt)
        if (!isNaN(d.getTime())) {
          scheduledAt = Timestamp.fromDate(d)
        }
      }

      const doc = {
        platform: platforms[0] === 'twitter' ? 'x' : platforms[0],
        orgId,
        content: { text: contentText, platformOverrides: {} },
        media: [],
        platforms,
        accountIds: post.accountIds ?? [],
        ...scopeFields,
        status,
        scheduledAt,
        scheduledFor: scheduledAt,
        publishedAt: null,
        platformResults: {},
        hashtags: post.hashtags,
        labels: post.labels,
        campaign: null,
        createdBy: userId,
        assignedTo: null,
        approval: emptyApprovalState(),
        approvedBy: null,
        approvedAt: null,
        comments: [],
        source: 'bulk_import' as const,
        threadParts: [],
        category: post.category,
        tags: post.tags,
        externalId: null,
        error: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }

      const docRef = await adminDb.collection('social_posts').add(doc)

      await logAudit({
        orgId,
        action: 'post.created',
        entityType: 'post',
        entityId: docRef.id,
        performedBy: userId,
        performedByRole: role,
        details: { platforms, status, source: 'bulk_import' },
        ip: req.headers.get('x-forwarded-for'),
      })

      results.push({ index: i, success: true, id: docRef.id })
    } catch (err: unknown) {
      results.push({ index: i, success: false, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return results
}
