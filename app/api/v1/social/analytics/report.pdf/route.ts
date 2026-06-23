/**
 * GET /api/v1/social/analytics/report.pdf
 * Generates a branded social analytics PDF for the org over an optional date
 * range (?days= or ?from=&to=), records a reports-history entry, and returns
 * the PDF as a downloadable attachment.
 */
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React, { createElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiErrorFromException } from '@/lib/api/response'
import {
  SocialAnalyticsReportPDF,
  type AnalyticsSummary,
  type PlatformBreakdownRow,
  type TopPostRow,
} from '@/lib/social/pdf/AnalyticsReport'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

function tsToMs(ts: any): number {
  if (!ts) return 0
  if (typeof ts === 'number') return ts
  if (ts._seconds != null) return ts._seconds * 1000
  if (ts.seconds != null) return ts.seconds * 1000
  const d = new Date(ts)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

function getPostText(post: any): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: any): string[] {
  if (Array.isArray(post.platforms) && post.platforms.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

export const GET = withAuth(
  'client',
  withTenant(async (req, user, orgId) => {
    try {
      const { searchParams } = new URL(req.url)
      const daysParam = searchParams.get('days')
      const fromParam = searchParams.get('from')
      const toParam = searchParams.get('to')

      // Resolve reporting window
      let fromMs: number | null = null
      let toMs: number | null = null
      let rangeLabel = 'All time'

      if (fromParam || toParam) {
        const f = fromParam ? new Date(fromParam) : null
        const t = toParam ? new Date(toParam) : null
        fromMs = f && !isNaN(f.getTime()) ? f.getTime() : null
        toMs = t && !isNaN(t.getTime()) ? t.getTime() : null
        const fLabel = fromMs ? new Date(fromMs).toLocaleDateString('en-ZA') : '…'
        const tLabel = toMs ? new Date(toMs).toLocaleDateString('en-ZA') : '…'
        rangeLabel = `${fLabel} – ${tLabel}`
      } else if (daysParam) {
        const days = parseInt(daysParam, 10)
        if (!isNaN(days) && days > 0) {
          toMs = Date.now()
          fromMs = toMs - days * 86400000
          rangeLabel = `Last ${days} days`
        }
      }

      // Org name
      const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
      const orgName: string = (orgSnap.exists && (orgSnap.data()?.name as string)) || orgId

      // Published posts for the org
      const postsSnap = await adminDb
        .collection('social_posts')
        .where('orgId', '==', orgId)
        .where('status', '==', 'published')
        .get()

      let posts = postsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as any)
        .filter((p) => p.accountScope !== 'personal')

      // Date-range filter on published/scheduled/created timestamp
      if (fromMs != null || toMs != null) {
        posts = posts.filter((p) => {
          const ms = tsToMs(p.publishedAt ?? p.scheduledFor ?? p.scheduledAt ?? p.createdAt)
          if (!ms) return false
          if (fromMs != null && ms < fromMs) return false
          if (toMs != null && ms > toMs) return false
          return true
        })
      }
      const postIds = new Set(posts.map((p) => p.id))

      // Analytics snapshots for the org
      const analyticsSnap = await adminDb
        .collection('social_analytics')
        .where('orgId', '==', orgId)
        .get()
      const analytics = analyticsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as any)

      // Latest snapshot per (post, platform) — used for summary + top posts
      const latestByKey = new Map<string, any>()
      for (const snap of analytics) {
        const key = `${snap.postId}::${snap.platform}`
        const existing = latestByKey.get(key)
        if (!existing || tsToMs(snap.collectedAt) > tsToMs(existing.collectedAt)) {
          latestByKey.set(key, snap)
        }
      }

      // Summary totals (org-wide latest snapshots, scoped to filtered posts when a range is set)
      const summary: AnalyticsSummary = {
        totalPublished: posts.length,
        impressions: 0,
        reach: 0,
        engagements: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        engagementRate: 0,
      }
      const rangeActive = fromMs != null || toMs != null
      for (const snap of latestByKey.values()) {
        if (rangeActive && !postIds.has(snap.postId)) continue
        const m = snap.metrics ?? {}
        summary.impressions += m.impressions ?? 0
        summary.reach += m.reach ?? 0
        summary.engagements += m.engagements ?? 0
        summary.likes += m.likes ?? 0
        summary.comments += m.comments ?? 0
        summary.shares += m.shares ?? 0
        summary.clicks += m.clicks ?? 0
      }
      summary.engagementRate = summary.impressions > 0
        ? (summary.engagements / summary.impressions) * 100
        : 0

      // Platform breakdown
      const breakdown = new Map<string, PlatformBreakdownRow>()
      const ensure = (platform: string): PlatformBreakdownRow => {
        let row = breakdown.get(platform)
        if (!row) {
          row = { platform, posts: 0, impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0 }
          breakdown.set(platform, row)
        }
        return row
      }
      for (const snap of latestByKey.values()) {
        if (rangeActive && !postIds.has(snap.postId)) continue
        const m = snap.metrics ?? {}
        const row = ensure(snap.platform)
        row.impressions += m.impressions ?? 0
        row.likes += m.likes ?? 0
        row.comments += m.comments ?? 0
        row.shares += m.shares ?? 0
        row.clicks += m.clicks ?? 0
      }
      for (const post of posts) {
        for (const p of getPostPlatforms(post)) ensure(p).posts += 1
      }
      const platforms = Array.from(breakdown.values()).sort((a, b) => b.impressions - a.impressions)

      // Top posts (by impressions, max 10)
      const perPost = new Map<string, { post: any; platforms: Set<string>; impressions: number; engagements: number; likes: number; clicks: number }>()
      for (const snap of latestByKey.values()) {
        if (!postIds.has(snap.postId)) continue
        const post = posts.find((p) => p.id === snap.postId)
        if (!post) continue
        let agg = perPost.get(snap.postId)
        if (!agg) {
          agg = { post, platforms: new Set(), impressions: 0, engagements: 0, likes: 0, clicks: 0 }
          perPost.set(snap.postId, agg)
        }
        const m = snap.metrics ?? {}
        agg.platforms.add(snap.platform)
        agg.impressions += m.impressions ?? 0
        agg.engagements += m.engagements ?? 0
        agg.likes += m.likes ?? 0
        agg.clicks += m.clicks ?? 0
      }
      const topPosts: TopPostRow[] = Array.from(perPost.values())
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10)
        .map((agg) => {
          const text = getPostText(agg.post).replace(/\s+/g, ' ').trim()
          return {
            content: text.length > 70 ? text.slice(0, 70) + '…' : text || '(no text)',
            platforms: Array.from(agg.platforms).map((p) => p.toUpperCase()).join(', '),
            impressions: agg.impressions,
            engagements: agg.engagements,
            likes: agg.likes,
            clicks: agg.clicks,
          }
        })

      const generatedAt = new Date().toISOString()

      // Render PDF
      const buffer = await renderToBuffer(
        // renderToBuffer expects ReactElement<DocumentProps>; the function
        // component structurally satisfies this at runtime but TS can't verify
        // it through the component boundary — cast is required (matches seo route).
        createElement(SocialAnalyticsReportPDF, {
          orgName,
          rangeLabel,
          generatedAt,
          summary,
          platforms,
          topPosts,
        }) as unknown as React.ReactElement<DocumentProps>,
      )

      // Record reports-history entry (best-effort; never block the download)
      try {
        await adminDb.collection('social_reports').add({
          orgId,
          type: 'analytics',
          title: `Social Analytics Report — ${rangeLabel}`,
          dateRange: {
            from: fromMs != null ? new Date(fromMs).toISOString() : null,
            to: toMs != null ? new Date(toMs).toISOString() : null,
            label: rangeLabel,
          },
          generatedBy: user.uid,
          createdAt: FieldValue.serverTimestamp(),
          metricsSummary: {
            totalPublished: summary.totalPublished,
            impressions: summary.impressions,
            reach: summary.reach,
            engagements: summary.engagements,
            likes: summary.likes,
            comments: summary.comments,
            shares: summary.shares,
            clicks: summary.clicks,
            engagementRate: summary.engagementRate,
          },
        })
      } catch (recordErr) {
        console.error('[social-analytics-pdf] failed to record report history', recordErr)
      }

      const dateStr = new Date(generatedAt).toISOString().slice(0, 10)
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="social-analytics-${orgId}-${dateStr}.pdf"`,
          'Cache-Control': 'no-store',
        },
      })
    } catch (err) {
      return apiErrorFromException(err)
    }
  }),
)
