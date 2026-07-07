#!/usr/bin/env node
import 'dotenv/config'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import process from 'node:process'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const orgIdArg = process.argv.find((arg) => arg.startsWith('--orgId='))
const orgId = orgIdArg?.slice('--orgId='.length).trim()

if (!orgId) {
  console.error('Usage: node scripts/backfill-portal-summaries.mjs --orgId=<orgId> [--apply]')
  process.exit(1)
}

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function initDb() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: env('FIREBASE_ADMIN_PROJECT_ID').replace(/^"|"$/g, ''),
        clientEmail: env('FIREBASE_ADMIN_CLIENT_EMAIL').replace(/^"|"$/g, ''),
        privateKey: env('FIREBASE_ADMIN_PRIVATE_KEY').replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    })
  }
  const db = getFirestore()
  db.settings({ ignoreUndefinedProperties: true })
  return db
}

function millis(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const seconds = value.seconds ?? value._seconds
  return typeof seconds === 'number' ? seconds * 1000 : 0
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isOpenProject(project) {
  const status = text(project.status).toLowerCase()
  return project.deleted !== true && project.archived !== true && !['completed', 'archived', 'cancelled'].includes(status)
}

function isActiveProject(project) {
  return ['active', 'in_progress', 'development', 'review', 'live', 'maintenance'].includes(text(project.status).toLowerCase())
}

function emptySeries() {
  return Array.from({ length: 7 }, (_, i) => ({ label: `W${i + 1}`, value: 0 }))
}

function dateFrom(value) {
  const ms = millis(value)
  return ms > 0 ? new Date(ms) : null
}

function trendDate(post) {
  const status = text(post.status, 'draft')
  if (status === 'published' || status === 'partially_published') {
    return dateFrom(post.publishedAt) ?? dateFrom(post.scheduledAt) ?? dateFrom(post.scheduledFor) ?? dateFrom(post.updatedAt) ?? dateFrom(post.createdAt)
  }
  if (status === 'scheduled' || status === 'publishing') {
    return dateFrom(post.scheduledAt) ?? dateFrom(post.scheduledFor) ?? dateFrom(post.updatedAt) ?? dateFrom(post.createdAt)
  }
  return null
}

function buildSocial(posts) {
  const stats = {
    total: posts.length,
    byStatus: { draft: 0, pending_approval: 0, approved: 0, scheduled: 0, published: 0, failed: 0, cancelled: 0 },
    byPlatform: {},
    approvalRate: 0,
    last30Days: 0,
    last30DaysSeries: emptySeries(),
  }
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const bucketSize = thirtyDaysMs / 7
  for (const post of posts) {
    const status = text(post.status, 'draft')
    if (status in stats.byStatus) stats.byStatus[status] += 1
    const platforms = Array.isArray(post.platforms) ? post.platforms : post.platform ? [post.platform] : []
    for (const platform of platforms) {
      if (typeof platform !== 'string' || !platform.trim()) continue
      stats.byPlatform[platform] = (stats.byPlatform[platform] ?? 0) + 1
    }
    const date = trendDate(post)
    if (!date) continue
    const age = Date.now() - date.getTime()
    if (age < 0 || age > thirtyDaysMs) continue
    const bucketFromNewest = Math.min(6, Math.floor(age / bucketSize))
    const bucket = 6 - bucketFromNewest
    stats.last30Days += 1
    stats.last30DaysSeries[bucket].value += 1
  }
  const reviewable = stats.byStatus.approved + stats.byStatus.draft
  stats.approvalRate = reviewable > 0 ? Math.round((stats.byStatus.approved / reviewable) * 100) : 0
  return stats
}

async function list(db, collection, field = 'orgId') {
  const snap = await db.collection(collection).where(field, '==', orgId).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

async function listProjects(db) {
  const byId = new Map()
  const snaps = await Promise.all([
    db.collection('projects').where('recipientOrgId', '==', orgId).get(),
    db.collection('projects').where('targetOrgId', '==', orgId).get(),
    db.collection('projects').where('clientOrgId', '==', orgId).get(),
    db.collection('projects').where('orgId', '==', orgId).get(),
  ])
  for (const snap of snaps) {
    for (const doc of snap.docs) byId.set(doc.id, { id: doc.id, ...doc.data() })
  }
  return Array.from(byId.values())
}

async function main() {
  const db = initDb()
  const [contactsRaw, campaignsRaw, captureSourcesRaw, socialPostsRaw, socialAccountsRaw, projectsRaw, orgDoc, connectionsSnap] = await Promise.all([
    list(db, 'contacts'),
    list(db, 'campaigns'),
    list(db, 'capture_sources'),
    list(db, 'social_posts'),
    list(db, 'social_accounts'),
    listProjects(db),
    db.collection('organizations').doc(orgId).get(),
    db.collectionGroup('connections').where('orgId', '==', orgId).get(),
  ])

  const contacts = contactsRaw.filter((row) => row.deleted !== true)
  const campaigns = campaignsRaw.filter((row) => row.deleted !== true)
  const captureSources = captureSourcesRaw.filter((row) => row.deleted !== true)
  const socialPosts = socialPostsRaw.filter((row) => row.deleted !== true)
  const socialAccounts = socialAccountsRaw.filter((row) => row.deleted !== true && row.accountScope !== 'personal')
  const projects = projectsRaw.filter(isOpenProject)
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt) || millis(b.createdAt) - millis(a.createdAt))
  const activeCampaigns = campaigns.filter((row) => row.status === 'active').length
  const activeAccounts = socialAccounts.filter((row) => row.status === 'active').length
  const social = buildSocial(socialPosts)
  const settings = orgDoc.exists ? (orgDoc.data().settings ?? {}) : {}
  const domainDone = settings.customDomain?.verified === true

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)
  const scheduledStatuses = new Set(['scheduled', 'approved', 'pending_approval', 'client_review', 'qa_review'])
  const scheduledPosts = socialPosts
    .filter((post) => scheduledStatuses.has(text(post.status)))
    .filter((post) => {
      const date = dateFrom(post.scheduledFor) ?? dateFrom(post.scheduledAt)
      return date && date >= todayStart && date < todayEnd
    })
    .sort((a, b) => millis(a.scheduledFor ?? a.scheduledAt) - millis(b.scheduledFor ?? b.scheduledAt))
    .slice(0, 12)

  const summary = {
    orgId,
    generatedAtIso: new Date().toISOString(),
    counts: {
      contacts: contacts.length,
      projects: projects.length,
      activeProjects: projects.filter(isActiveProject).length,
      posts: social.total,
      publishedPosts: social.byStatus.published,
      pendingApprovalPosts: social.byStatus.pending_approval,
      activeCampaigns,
      captureSources: captureSources.length,
      socialAccounts: activeAccounts,
    },
    projects: {
      total: projects.length,
      active: projects.filter(isActiveProject).length,
      recent: projects.slice(0, 6).map((project) => ({
        id: project.id,
        name: text(project.name, 'Untitled project'),
        status: text(project.status, 'discovery'),
        description: text(project.description),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })),
    },
    social,
    scheduledPosts,
    campaigns: { active: activeCampaigns },
    crm: { contacts: contacts.length },
    onboarding: {
      social: activeAccounts > 0,
      domain: domainDone,
      contact: contacts.length > 0,
      analytics: connectionsSnap.size > 0,
      post: social.byStatus.published > 0,
    },
    stale: false,
    staleReason: null,
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    orgId,
    counts: summary.counts,
    recentProjects: summary.projects.recent.length,
    scheduledPosts: summary.scheduledPosts.length,
  }, null, 2))

  if (apply) {
    await db.collection('org_portal_summaries').doc(orgId).set({
      ...summary,
      generatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    console.log(`Wrote org_portal_summaries/${orgId}`)
  } else {
    console.log('Dry run only. Re-run with --apply to write.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
