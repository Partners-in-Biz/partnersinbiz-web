/**
 * GET /api/v1/social/listening/mentions — matched mentions for monitored terms
 *
 * Pulls from `social_inbox` (orgId scoped) and surfaces items that are either
 * of type 'mention', or any item whose content contains an active monitored term.
 * Each returned mention carries the list of monitored terms it matched.
 *
 * Query params:
 *   ?term=<term>       filter to mentions matching a specific monitored term
 *   ?platform=<plat>   filter to a single platform
 *   ?limit=<n>         cap the number of returned mentions (default 100, max 500)
 *   ?format=csv        return a CSV download instead of JSON
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

interface MentionResult {
  id: string
  platform: string
  type: string
  fromUser: { name: string; username: string; avatarUrl: string; profileUrl: string } | string
  content: string
  platformUrl: string
  sentiment: string | null
  createdAt: unknown
  matchedTerms: string[]
}

function tsToIso(ts: unknown): string {
  if (!ts) return ''
  const t = ts as { _seconds?: number; seconds?: number; toDate?: () => Date }
  if (typeof t.toDate === 'function') return t.toDate().toISOString()
  if (t._seconds) return new Date(t._seconds * 1000).toISOString()
  if (t.seconds) return new Date(t.seconds * 1000).toISOString()
  if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).toISOString()
  return ''
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function fromUserName(fromUser: MentionResult['fromUser']): string {
  if (typeof fromUser === 'string') return fromUser
  if (fromUser && typeof fromUser === 'object') {
    return fromUser.name || fromUser.username || ''
  }
  return ''
}

export const GET = withAuth('client', withTenant(async (req, _user, orgId) => {
  try {
    const { searchParams } = new URL(req.url)
    const termFilter = searchParams.get('term')?.trim().toLowerCase() || null
    const platformFilter = searchParams.get('platform')?.trim() || null
    const format = searchParams.get('format')?.trim().toLowerCase() || null
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10)))

    // Load the org's active monitored terms.
    const termsSnap = await adminDb
      .collection('social_listening_terms')
      .where('orgId', '==', orgId)
      .where('active', '==', true)
      .get()

    const activeTerms = termsSnap.docs
      .map((d) => String(d.data().term ?? '').trim())
      .filter((t) => t.length > 0)
    const loweredTerms = activeTerms.map((t) => t.toLowerCase())

    // Pull inbox items for the org.
    let inboxQuery = adminDb.collection('social_inbox').where('orgId', '==', orgId)
    if (platformFilter) {
      inboxQuery = inboxQuery.where('platform', '==', platformFilter)
    }
    const inboxSnap = await inboxQuery.get()

    const mentions: MentionResult[] = []

    for (const doc of inboxSnap.docs) {
      const data = doc.data()
      const content = String(data.content ?? '')
      const loweredContent = content.toLowerCase()
      const type = String(data.type ?? '')

      // Determine which monitored terms appear in the content.
      const matchedTerms = activeTerms.filter((_t, i) => loweredContent.includes(loweredTerms[i]))

      const isMention = type === 'mention'

      // Surface the item if it's a mention OR it contains a monitored term.
      if (!isMention && matchedTerms.length === 0) continue

      // Apply ?term= filter: item must match that specific term.
      if (termFilter) {
        const hit = matchedTerms.some((t) => t.toLowerCase() === termFilter)
        if (!hit) continue
      }

      mentions.push({
        id: doc.id,
        platform: String(data.platform ?? ''),
        type,
        fromUser: data.fromUser ?? '',
        content,
        platformUrl: String(data.platformUrl ?? ''),
        sentiment: data.sentiment ?? null,
        createdAt: data.createdAt ?? null,
        matchedTerms,
      })
    }

    // Sort newest first by createdAt.
    mentions.sort((a, b) => {
      const av = new Date(tsToIso(a.createdAt) || 0).getTime()
      const bv = new Date(tsToIso(b.createdAt) || 0).getTime()
      return bv - av
    })

    const limited = mentions.slice(0, limit)

    if (format === 'csv') {
      const header = [
        'platform',
        'type',
        'fromUser',
        'content',
        'sentiment',
        'matchedTerms',
        'createdAt',
        'platformUrl',
      ]
      const rows = limited.map((m) =>
        [
          m.platform,
          m.type,
          fromUserName(m.fromUser),
          m.content,
          m.sentiment ?? '',
          m.matchedTerms.join('; '),
          tsToIso(m.createdAt),
          m.platformUrl,
        ]
          .map((v) => csvEscape(String(v ?? '')))
          .join(',')
      )
      const csv = [header.join(','), ...rows].join('\r\n')

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="social-mentions.csv"',
        },
      })
    }

    return apiSuccess({ mentions: limited }, 200, { total: limited.length })
  } catch (error) {
    console.error('Error fetching mentions:', error)
    return apiError('Failed to fetch mentions', 500)
  }
}))
