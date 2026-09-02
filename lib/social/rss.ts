/**
 * RSS Feed Parser & Auto-Post Creator
 *
 * Parses RSS/Atom feeds, detects new items since last check,
 * and creates draft social posts from a configurable template.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { companyFieldsForWrite } from '@/lib/work-scope'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RssFeed {
  id?: string
  orgId: string
  name: string
  feedUrl: string
  status: 'active' | 'paused' | 'error'
  targetAccountIds: string[]
  targetPlatforms: string[]
  postTemplate: string
  includeImage: boolean
  autoSchedule: boolean
  schedulingStrategy: 'immediate' | 'best_time' | 'queue'
  lastCheckedAt: Timestamp | null
  lastPublishedItemUrl: string | null
  itemsPublished: number
  checkIntervalMinutes: number
  consecutiveErrors: number
  lastError: string | null
  companyId?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface RssFeedItem {
  title: string
  link: string
  description: string
  pubDate: Date | null
  imageUrl: string | null
  categories: string[]
  author: string | null
}

// ---------------------------------------------------------------------------
// XML parsing helpers (lightweight, no external dependency)
// ---------------------------------------------------------------------------

function getTagContent(xml: string, tag: string): string {
  // Handles both <tag>content</tag> and <tag attr="x">content</tag>
  const openPattern = new RegExp(`<${tag}[^>]*>`, 'i')
  const closePattern = new RegExp(`</${tag}>`, 'i')
  const openMatch = openPattern.exec(xml)
  if (!openMatch) return ''
  const start = openMatch.index + openMatch[0].length
  const closeMatch = closePattern.exec(xml.slice(start))
  if (!closeMatch) return ''
  return xml.slice(start, start + closeMatch.index).trim()
}

function getAttr(xml: string, tag: string, attr: string): string {
  const pattern = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i')
  const match = pattern.exec(xml)
  return match?.[1] ?? ''
}

function getAllBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = []
  const openPattern = new RegExp(`<${tag}[^>]*>`, 'gi')
  const closeTag = `</${tag}>`
  let match: RegExpExecArray | null
  while ((match = openPattern.exec(xml)) !== null) {
    const start = match.index
    const closeIdx = xml.toLowerCase().indexOf(closeTag.toLowerCase(), start + match[0].length)
    if (closeIdx === -1) continue
    blocks.push(xml.slice(start, closeIdx + closeTag.length))
  }
  return blocks
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim()
}

function extractImageUrl(html: string): string | null {
  const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(html)
  if (imgMatch) return imgMatch[1]
  const enclosureMatch = /<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i.exec(html)
  if (enclosureMatch) return enclosureMatch[1]
  return null
}

// ---------------------------------------------------------------------------
// Feed parser
// ---------------------------------------------------------------------------

export async function parseFeed(feedUrl: string): Promise<RssFeedItem[]> {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'PartnersinBiz/1.0 RSS Reader' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Feed fetch failed: ${res.status} ${res.statusText}`)
  }

  const xml = await res.text()
  const items: RssFeedItem[] = []

  // Detect RSS 2.0 vs Atom
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"')

  if (isAtom) {
    const entries = getAllBlocks(xml, 'entry')
    for (const entry of entries) {
      items.push({
        title: stripCdata(stripHtml(getTagContent(entry, 'title'))),
        link: getAttr(entry, 'link', 'href') || stripCdata(getTagContent(entry, 'link')),
        description: stripHtml(stripCdata(getTagContent(entry, 'summary') || getTagContent(entry, 'content'))),
        pubDate: parseDate(getTagContent(entry, 'published') || getTagContent(entry, 'updated')),
        imageUrl: extractImageUrl(entry),
        categories: getAllBlocks(entry, 'category').map(c => getAttr(c, 'category', 'term') || stripCdata(getTagContent(c, 'category'))).filter(Boolean),
        author: stripCdata(getTagContent(getTagContent(entry, 'author'), 'name')) || null,
      })
    }
  } else {
    // RSS 2.0
    const itemBlocks = getAllBlocks(xml, 'item')
    for (const block of itemBlocks) {
      const descRaw = getTagContent(block, 'description') || getTagContent(block, 'content:encoded')
      items.push({
        title: stripCdata(stripHtml(getTagContent(block, 'title'))),
        link: stripCdata(getTagContent(block, 'link')),
        description: stripHtml(stripCdata(descRaw)).slice(0, 500),
        pubDate: parseDate(getTagContent(block, 'pubDate') || getTagContent(block, 'dc:date')),
        imageUrl: extractImageUrl(block) || extractImageUrl(descRaw),
        categories: getAllBlocks(block, 'category').map(c => stripCdata(stripHtml(c.replace(/<\/?category[^>]*>/gi, '')))).filter(Boolean),
        author: stripCdata(getTagContent(block, 'dc:creator') || getTagContent(block, 'author')) || null,
      })
    }
  }

  return items
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

export function renderTemplate(template: string, item: RssFeedItem): string {
  return template
    .replace(/\{\{title\}\}/g, item.title)
    .replace(/\{\{url\}\}/g, item.link)
    .replace(/\{\{link\}\}/g, item.link)
    .replace(/\{\{description\}\}/g, item.description.slice(0, 200))
    .replace(/\{\{author\}\}/g, item.author ?? '')
    .replace(/\{\{category\}\}/g, item.categories[0] ?? '')
    .replace(/\{\{categories\}\}/g, item.categories.join(', '))
}

// ---------------------------------------------------------------------------
// Feed check & draft creation
// ---------------------------------------------------------------------------

export interface FeedCheckResult {
  feedId: string
  newItems: number
  postsCreated: number
  errors: string[]
}

export async function checkFeed(feedId: string): Promise<FeedCheckResult> {
  const result: FeedCheckResult = { feedId, newItems: 0, postsCreated: 0, errors: [] }

  const feedDoc = await adminDb.collection('social_rss_feeds').doc(feedId).get()
  if (!feedDoc.exists) {
    result.errors.push('Feed not found')
    return result
  }

  const feed = { id: feedDoc.id, ...feedDoc.data() } as RssFeed

  if (feed.status !== 'active') {
    return result
  }

  let items: RssFeedItem[]
  try {
    items = await parseFeed(feed.feedUrl)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown parse error'
    result.errors.push(msg)
    await adminDb.collection('social_rss_feeds').doc(feedId).update({
      consecutiveErrors: FieldValue.increment(1),
      lastError: msg,
      lastCheckedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    // Auto-pause after 5 consecutive errors
    if ((feed.consecutiveErrors ?? 0) + 1 >= 5) {
      await adminDb.collection('social_rss_feeds').doc(feedId).update({ status: 'error' })
    }
    return result
  }

  // Filter to items newer than last check
  const lastCheckedMs = feed.lastCheckedAt
    ? feed.lastCheckedAt.toMillis()
    : 0
  const lastUrl = feed.lastPublishedItemUrl

  const newItems = items.filter((item) => {
    if (item.link === lastUrl) return false
    if (item.pubDate && item.pubDate.getTime() > lastCheckedMs) return true
    // First check: take up to 5 most recent items
    if (lastCheckedMs === 0) return true
    return false
  })

  // Limit to 10 new items per check to avoid flooding
  const toProcess = lastCheckedMs === 0 ? newItems.slice(0, 5) : newItems.slice(0, 10)
  result.newItems = toProcess.length

  for (const item of toProcess) {
    try {
      const text = renderTemplate(feed.postTemplate || '{{title}} {{url}}', item)

      const postDoc = {
        orgId: feed.orgId,
        platform: feed.targetPlatforms[0] ?? 'twitter',
        content: { text, platformOverrides: {} },
        media: [],
        platforms: feed.targetPlatforms,
        accountIds: feed.targetAccountIds,
        status: feed.autoSchedule ? 'scheduled' : 'draft',
        scheduledAt: feed.autoSchedule ? FieldValue.serverTimestamp() : null,
        scheduledFor: feed.autoSchedule ? FieldValue.serverTimestamp() : null,
        publishedAt: null,
        platformResults: {},
        hashtags: item.categories.slice(0, 5).map(c => `#${c.replace(/\s+/g, '')}`),
        labels: ['rss'],
        campaign: null,
        createdBy: 'system',
        assignedTo: null,
        approvedBy: null,
        approvedAt: null,
        comments: [],
        source: 'rss' as const,
        rssSourceId: feedId,
        ...companyFieldsForWrite(feed.companyId),
        threadParts: [],
        category: 'other',
        tags: ['rss', feed.name],
        externalId: null,
        error: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }

      const docRef = await adminDb.collection('social_posts').add(postDoc)

      // Create queue entry if auto-scheduling
      if (feed.autoSchedule) {
        await adminDb.collection('social_queue').doc(docRef.id).set({
          orgId: feed.orgId,
          postId: docRef.id,
          scheduledAt: FieldValue.serverTimestamp(),
          status: 'pending',
          priority: -1, // low priority for RSS
          attempts: 0,
          maxAttempts: 5,
          lastAttemptAt: null,
          nextRetryAt: null,
          backoffSeconds: 60,
          lockedBy: null,
          lockedAt: null,
          startedAt: null,
          completedAt: null,
          error: null,
          createdAt: FieldValue.serverTimestamp(),
        })
      }

      result.postsCreated++
    } catch (err: unknown) {
      result.errors.push(err instanceof Error ? err.message : 'Post creation failed')
    }
  }

  // Update feed tracking
  const latestUrl = toProcess[0]?.link ?? feed.lastPublishedItemUrl
  await adminDb.collection('social_rss_feeds').doc(feedId).update({
    lastCheckedAt: FieldValue.serverTimestamp(),
    lastPublishedItemUrl: latestUrl,
    itemsPublished: FieldValue.increment(result.postsCreated),
    consecutiveErrors: 0,
    lastError: null,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return result
}

// ---------------------------------------------------------------------------
// Process all active feeds (called by cron)
// ---------------------------------------------------------------------------

export interface RssCronResult {
  feedsChecked: number
  totalNewItems: number
  totalPostsCreated: number
  errors: Array<{ feedId: string; error: string }>
}

export async function processRssFeeds(): Promise<RssCronResult> {
  const result: RssCronResult = { feedsChecked: 0, totalNewItems: 0, totalPostsCreated: 0, errors: [] }

  const now = Date.now()
  const snapshot = await adminDb.collection('social_rss_feeds')
    .where('status', '==', 'active')
    .get()

  const feeds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RssFeed))

  for (const feed of feeds) {
    // Skip if not due for check
    const lastChecked = feed.lastCheckedAt?.toMillis() ?? 0
    const intervalMs = (feed.checkIntervalMinutes ?? 60) * 60 * 1000
    if (lastChecked > 0 && now - lastChecked < intervalMs) continue

    result.feedsChecked++
    try {
      const feedResult = await checkFeed(feed.id!)
      result.totalNewItems += feedResult.newItems
      result.totalPostsCreated += feedResult.postsCreated
      for (const err of feedResult.errors) {
        result.errors.push({ feedId: feed.id!, error: err })
      }
    } catch (err: unknown) {
      result.errors.push({
        feedId: feed.id!,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return result
}
