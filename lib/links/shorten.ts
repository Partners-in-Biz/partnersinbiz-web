import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ShortenedLink, LinkStats } from './types'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const SHORT_CODE_LENGTH = 7

/**
 * Generates a random 7-character alphanumeric short code
 */
export function generateShortCode(): string {
  let code = ''
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += CHARS.charAt(Math.floor(Math.random() * CHARS.length))
  }
  return code
}

/**
 * Ensures a short code is unique in the database, regenerating if necessary
 */
async function ensureUniqueCode(orgId: string, code: string, attempts = 0): Promise<string> {
  if (attempts > 10) {
    throw new Error('Failed to generate unique short code after 10 attempts')
  }

  const existing = await adminDb
    .collection('shortened_links')
    .where('orgId', '==', orgId)
    .where('shortCode', '==', code)
    .limit(1)
    .get()

  if (existing.empty) {
    return code
  }

  // Regenerate and try again
  return ensureUniqueCode(orgId, generateShortCode(), attempts + 1)
}

/**
 * Builds the final URL with UTM parameters appended
 */
function buildUrlWithUtm(originalUrl: string, utmParams?: Record<string, string>): string {
  if (!utmParams || Object.keys(utmParams).length === 0) {
    return originalUrl
  }

  const url = new URL(originalUrl)
  Object.entries(utmParams).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value)
    }
  })
  return url.toString()
}

export interface CreateLinkOptions {
  propertyId?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  customShortCode?: string
}

/**
 * Creates a new shortened link with optional UTM parameters
 */
export async function createShortLink(
  orgId: string,
  originalUrl: string,
  options: CreateLinkOptions = {},
  createdBy: string,
): Promise<ShortenedLink> {
  // Validate URL
  try {
    new URL(originalUrl)
  } catch {
    throw new Error('Invalid URL provided')
  }

  const seedCode = options.customShortCode?.trim() || generateShortCode()
  const shortCode = await ensureUniqueCode(orgId, seedCode)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const shortUrl = `${appUrl}/l/${shortCode}`

  const doc = {
    orgId,
    propertyId: options.propertyId || undefined,
    originalUrl,
    shortCode,
    shortUrl,
    utmSource: options.utmSource || undefined,
    utmMedium: options.utmMedium || undefined,
    utmCampaign: options.utmCampaign || undefined,
    utmTerm: options.utmTerm || undefined,
    utmContent: options.utmContent || undefined,
    clickCount: 0,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('shortened_links').add(doc)

  return {
    id: docRef.id,
    ...doc,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }
}

/**
 * Resolves a short code to the original URL with UTM params appended
 */
export async function resolveShortCode(
  shortCode: string,
): Promise<{ url: string; linkId: string; orgId: string; contactId?: string } | null> {
  const snapshot = await adminDb
    .collection('shortened_links')
    .where('shortCode', '==', shortCode)
    .limit(1)
    .get()

  if (snapshot.empty) {
    return null
  }

  const doc = snapshot.docs[0]
  const data = doc.data() as Omit<ShortenedLink, 'createdAt' | 'updatedAt'> & { contactId?: string }

  const utmParams: Record<string, string> = {}
  if (data.utmSource) utmParams.utm_source = data.utmSource
  if (data.utmMedium) utmParams.utm_medium = data.utmMedium
  if (data.utmCampaign) utmParams.utm_campaign = data.utmCampaign
  if (data.utmTerm) utmParams.utm_term = data.utmTerm
  if (data.utmContent) utmParams.utm_content = data.utmContent

  const finalUrl = buildUrlWithUtm(data.originalUrl, utmParams)

  return {
    url: finalUrl,
    linkId: doc.id,
    orgId: data.orgId ?? '',
    contactId: data.contactId,
  }
}

/**
 * Tracks a click on a shortened link
 * This is fire-and-forget; errors are logged but not thrown
 */
export async function trackClick(
  linkId: string,
  orgId: string,
  request: Request,
  opts?: { contactId?: string; destinationUrl?: string },
): Promise<void> {
  try {
    const referrer = request.headers.get('referer')
    const userAgent = request.headers.get('user-agent')
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')

    await adminDb.collection('shortened_links').doc(linkId).collection('clicks').add({
      linkId,
      orgId,
      timestamp: FieldValue.serverTimestamp(),
      referrer,
      userAgent,
      ip,
      country: null,
    })

    await adminDb.collection('shortened_links').doc(linkId).update({
      clickCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Write a top-level click event for behavioral segmentation. Keep this
    // separate from the per-link subcollection so link-url segment preview can
    // query all tracked clicks for an org without walking every link document.
    if (orgId) {
      const clickedAt = FieldValue.serverTimestamp()
      await adminDb.collection('link_clicks').add({
        orgId,
        contactId: opts?.contactId ?? '',
        shortenedLinkId: linkId,
        linkId,
        targetUrl: opts?.destinationUrl ?? '',
        clickedAt,
        createdAt: clickedAt,
        referrer,
        userAgent,
        ip,
      })

      await adminDb.collection('activities').add({
        orgId,
        contactId: opts?.contactId ?? '',
        type: 'link_click',
        summary: `Clicked tracked link`,
        metadata: {
          linkId,
          destinationUrl: opts?.destinationUrl ?? '',
          referrer,
          userAgent,
        },
        createdBy: 'system',
        createdAt: FieldValue.serverTimestamp(),
      })
    }
  } catch (error) {
    console.error('[Links] Failed to track click:', error)
    // Don't throw — this is fire-and-forget
  }
}

/**
 * Gets detailed click analytics for a link
 */
export async function getLinkStats(linkId: string, orgId: string): Promise<LinkStats> {
  const snapshot = await adminDb
    .collection('shortened_links')
    .doc(linkId)
    .collection('clicks')
    .orderBy('timestamp', 'desc')
    .limit(1000)
    .get()

  const clicks = snapshot.docs.map(doc => {
    const data = doc.data()
    return {
      timestamp: data.timestamp as Timestamp,
      referrer: data.referrer as string | null,
      country: data.country as string | null,
    }
  })

  // Build day-by-day breakdown
  const clicksByDay: Record<string, number> = {}
  clicks.forEach(click => {
    const date = new Date(click.timestamp.toDate())
    const dateStr = date.toISOString().split('T')[0]
    clicksByDay[dateStr] = (clicksByDay[dateStr] || 0) + 1
  })

  const clicksByDayArray = Object.entries(clicksByDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Top referrers
  const referrerCounts: Record<string, number> = {}
  clicks.forEach(click => {
    if (click.referrer) {
      referrerCounts[click.referrer] = (referrerCounts[click.referrer] || 0) + 1
    }
  })

  const topReferrers = Object.entries(referrerCounts)
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Top countries
  const countryCounts: Record<string, number> = {}
  clicks.forEach(click => {
    if (click.country) {
      countryCounts[click.country] = (countryCounts[click.country] || 0) + 1
    }
  })

  const topCountries = Object.entries(countryCounts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    totalClicks: clicks.length,
    clicksByDay: clicksByDayArray,
    topReferrers,
    topCountries,
    recentClicks: clicks.slice(0, 20),
  }
}
