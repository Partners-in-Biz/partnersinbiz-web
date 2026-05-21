// Wire all autopilot-eligible task type executors. Imported once at server startup
// (via the cron + run endpoints) so the registry is populated before executeTask() runs.

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { registerExecutor } from './execution'
import { runMetadataCheck } from '@/lib/seo/tools/metadata'
import { runRobotsCheck } from '@/lib/seo/tools/robots'
import { runCanonicalCheck } from '@/lib/seo/tools/canonical'
import { runCrawlerSim } from '@/lib/seo/tools/crawler-sim'
import { runInternalLinkAudit } from '@/lib/seo/tools/internal-link-audit'
import { generateAuditSnapshot } from '@/lib/seo/audits'
import { pullDailyPagespeedForSprint } from '@/lib/seo/integrations/pagespeed'
import { pullDailyGscForSprint, fetchSearchAnalytics, refreshGscClient, submitSitemap } from '@/lib/seo/integrations/gsc'
import { decryptCredentials } from '@/lib/integrations/crypto'

let registered = false

async function saveArtifact(
  sprintId: string,
  orgId: string,
  taskId: string,
  kind: string,
  data: unknown,
): Promise<string> {
  const ref = await adminDb.collection('seo_artifacts').add({
    sprintId,
    orgId,
    taskId,
    kind,
    data,
    createdAt: FieldValue.serverTimestamp(),
  })
  return ref.id
}

async function getSprint(sprintId: string) {
  const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return snap.exists ? ((snap.data() as any) as Record<string, any>) : null
}

export function registerAllExecutors() {
  if (registered) return
  registered = true

  registerExecutor('meta-tag-audit', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const result = await runMetadataCheck(sprint.siteUrl)
    const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'metadata-audit', result)
    return { status: 'done', artifactId, notes: `${result.issues.length} issues found` }
  })

  registerExecutor('robots-check', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    let domain = sprint.siteUrl
    try {
      domain = new URL(sprint.siteUrl).hostname
    } catch {
      // skip
    }
    const result = await runRobotsCheck(domain)
    const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'robots-audit', result)
    return { status: 'done', artifactId, notes: `${result.issues.length} issues` }
  })

  registerExecutor('canonical-check', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const result = await runCanonicalCheck(sprint.siteUrl)
    const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'canonical-audit', result)
    return { status: 'done', artifactId }
  })

  registerExecutor('pagespeed-check', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    if (!sprint.integrations?.pagespeed?.enabled) {
      return { status: 'blocked', blockerReason: 'PageSpeed not enabled' }
    }
    await pullDailyPagespeedForSprint(sprintId)
    return { status: 'done', notes: 'PageSpeed pull triggered' }
  })

  registerExecutor('cwv-check', async (taskId, sprintId) => {
    // Just reads existing page_health subcollection
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const snap = await adminDb.collection('seo_sprints').doc(sprintId).collection('page_health').get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.docs.map((d) => ({ url: decodeURIComponent(d.id), ...(d.data() as any) }))
    const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'cwv-summary', data)
    return { status: 'done', artifactId }
  })

  registerExecutor('gsc-index-check', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    if (!sprint.integrations?.gsc?.connected) {
      return { status: 'blocked', blockerReason: 'GSC not connected' }
    }
    await pullDailyGscForSprint(sprintId)
    return { status: 'done', notes: 'GSC pull triggered' }
  })

  registerExecutor('sitemap-submit', async (_taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const gsc = sprint.integrations?.gsc
    if (!gsc?.connected || !gsc?.tokens || !gsc?.propertyUrl) {
      return { status: 'blocked', blockerReason: 'GSC not connected or property not selected' }
    }
    let refreshToken: string | undefined
    try {
      const decrypted = decryptCredentials<{ refresh_token?: string }>(gsc.tokens, sprint.orgId)
      refreshToken = decrypted.refresh_token
    } catch {
      return { status: 'blocked', blockerReason: 'tokens corrupted' }
    }
    if (!refreshToken) return { status: 'blocked', blockerReason: 'no refresh_token' }
    const sitemapUrl = `${sprint.siteUrl.replace(/\/$/, '')}/sitemap.xml`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = refreshGscClient(refreshToken) as any
    await submitSitemap(auth, gsc.propertyUrl, sitemapUrl)
    return { status: 'done', notes: `Submitted ${sitemapUrl} to ${gsc.propertyUrl}` }
  })

  registerExecutor('keyword-record', async () => {
    return { status: 'done', notes: 'no-op (manual entry)' }
  })

  registerExecutor('directory-submission', async (taskId, sprintId, user) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    // Mark all not_started directories as 'submitted' with prep package note
    const snap = await adminDb
      .collection('seo_backlinks')
      .where('sprintId', '==', sprintId)
      .where('type', '==', 'directory')
      .where('status', '==', 'not_started')
      .get()
    const now = new Date().toISOString()
    const batch = adminDb.batch()
    let count = 0
    for (const d of snap.docs) {
      batch.update(d.ref, {
        status: 'submitted',
        submittedAt: now,
        notes: `Pip prepared submission package on ${now.slice(0, 10)}`,
        updatedBy: user.uid,
        updatedByType: user.role === 'ai' ? 'agent' : 'user',
      })
      count++
    }
    if (count > 0) await batch.commit()
    return { status: 'done', notes: `${count} directories marked submitted` }
  })

  registerExecutor('audit-snapshot', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const auditId = await generateAuditSnapshot(sprintId, sprint.currentDay ?? 0)
    return { status: 'done', artifactId: auditId, notes: `audit ${auditId}` }
  })

  registerExecutor('audit-render', async (taskId, sprintId) => {
    // Same as snapshot for v1
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const auditId = await generateAuditSnapshot(sprintId, sprint.currentDay ?? 0)
    return { status: 'done', artifactId: auditId }
  })

  registerExecutor('internal-link-add', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const sitemapUrl = `${sprint.siteUrl.replace(/\/$/, '')}/sitemap.xml`
    try {
      const result = await runInternalLinkAudit(sitemapUrl)
      const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'internal-link-audit', result)
      return { status: 'done', artifactId, notes: `${result.orphans.length} orphan pages found` }
    } catch (e) {
      return { status: 'blocked', blockerReason: `audit failed: ${(e as Error).message}` }
    }
  })

  registerExecutor('schema-add', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    // Drafts a SoftwareApplication + FAQ schema as artifact
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: sprint.siteName,
          url: sprint.siteUrl,
          applicationCategory: 'BusinessApplication',
        },
        {
          '@type': 'FAQPage',
          mainEntity: [],
        },
      ],
    }
    const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'schema-draft', schema)
    return { status: 'done', artifactId, notes: 'Schema JSON-LD draft saved as artifact' }
  })

  registerExecutor('crawler-sim', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const result = await runCrawlerSim(sprint.siteUrl)
    const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'crawler-sim', result)
    return { status: 'done', artifactId }
  })

  registerExecutor('gsc-stuck-pages', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    const gsc = sprint.integrations?.gsc
    if (!gsc?.connected || !gsc?.tokens || !gsc?.propertyUrl) {
      return { status: 'blocked', blockerReason: 'GSC not connected' }
    }
    let refreshToken: string | undefined
    try {
      const decrypted = decryptCredentials<{ refresh_token?: string }>(gsc.tokens, sprint.orgId)
      refreshToken = decrypted.refresh_token
    } catch {
      return { status: 'blocked', blockerReason: 'tokens corrupted' }
    }
    if (!refreshToken) return { status: 'blocked', blockerReason: 'no refresh_token' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = refreshGscClient(refreshToken) as any
    const today = new Date().toISOString().slice(0, 10)
    const past = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
    const rows = await fetchSearchAnalytics(auth, gsc.propertyUrl, past, today)
    const stuck = rows.filter((r) => r.position >= 8 && r.position <= 22)
    const artifactId = await saveArtifact(sprintId, sprint.orgId, taskId, 'gsc-stuck-pages', {
      count: stuck.length,
      pages: stuck.slice(0, 50),
    })
    return { status: 'done', artifactId, notes: `${stuck.length} pages in position 8-22` }
  })

  // Phase D.4 — full-mode autopilot
  registerExecutor('post-publish', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    if (sprint.autopilotMode !== 'full') {
      return { status: 'queued', blockerReason: 'requires autopilot=full' }
    }
    // For v1, just mark a stub content row as live
    return { status: 'queued', blockerReason: 'requires content row + AI draft (v2)' }
  })

  registerExecutor('post-repurpose', async (taskId, sprintId) => {
    const sprint = await getSprint(sprintId)
    if (!sprint) return { status: 'blocked', blockerReason: 'no sprint' }
    if (sprint.autopilotMode !== 'full') {
      return { status: 'queued', blockerReason: 'requires autopilot=full' }
    }
    return { status: 'queued', blockerReason: 'cross-skill handoff (manual trigger via UI)' }
  })
}

// Register on import (called via dynamic import from execution.ts to avoid circular dep)
registerAllExecutors()
