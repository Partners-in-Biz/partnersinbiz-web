/**
 * Dev seed for signed-in YouTube Studio / Video Editor smokes.
 * EMULATOR-ONLY — refuses to run unless ALLOW_DEV_SEED=1 and both
 * FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST point at localhost.
 *
 * Run:
 *   firebase emulators:start --only auth,firestore --project partners-in-biz-85059 &
 *   ALLOW_DEV_SEED=1 \
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   npx tsx scripts/dev-seed-youtube-studio.ts
 *
 * Then run the dev server with the SAME two emulator env vars so the app's
 * firebase-admin talks to the emulators, and sign in as:
 *   admin:  dev-admin@pib.local  / dev-seed-password-1
 *   client: dev-client@pib.local / dev-seed-password-1
 *
 * Idempotent: uses fixed document IDs and set(..., { merge: true }).
 */

import { assertDevSeedAllowed } from '@/lib/dev-seed/guard'

assertDevSeedAllowed()

// Import AFTER the guard so firebase-admin never initialises in a refused run.
async function main() {
  const { adminAuth, adminDb } = await import('@/lib/firebase/admin')
  const { FieldValue } = await import('firebase-admin/firestore')
  const { YOUTUBE_COLLECTIONS } = await import('@/lib/youtube-studio/api')
  const { VIDEO_EDITOR_COLLECTIONS } = await import('@/lib/video-editor/api')

  const ORG_ID = 'dev-seed-yt-org'
  const CHANNEL_ID = 'dev-seed-yt-channel'
  const PASSWORD = 'dev-seed-password-1'
  const now = FieldValue.serverTimestamp()
  const actor = { createdByType: 'user', updatedByType: 'user', createdAt: now, updatedAt: now }

  async function ensureUser(email: string, displayName: string): Promise<string> {
    try {
      const existing = await adminAuth.getUserByEmail(email)
      return existing.uid
    } catch {
      const created = await adminAuth.createUser({ email, password: PASSWORD, displayName, emailVerified: true })
      return created.uid
    }
  }

  const adminUid = await ensureUser('dev-admin@pib.local', 'Dev Admin')
  const clientUid = await ensureUser('dev-client@pib.local', 'Dev Client')

  await adminDb.collection('users').doc(adminUid).set({
    email: 'dev-admin@pib.local', displayName: 'Dev Admin', role: 'admin',
    orgIds: [ORG_ID], activeOrgId: ORG_ID, createdAt: now, updatedAt: now,
  }, { merge: true })
  await adminDb.collection('users').doc(clientUid).set({
    email: 'dev-client@pib.local', displayName: 'Dev Client', role: 'client',
    orgIds: [ORG_ID], activeOrgId: ORG_ID, orgId: ORG_ID, createdAt: now, updatedAt: now,
  }, { merge: true })

  await adminDb.collection('organizations').doc(ORG_ID).set({
    name: 'Dev Seed Studio', slug: 'dev-seed-studio',
    members: [
      { userId: adminUid, role: 'owner' },
      { userId: clientUid, role: 'owner' },
    ],
    settings: { portalModules: { youtubeStudio: true } },
    createdAt: now, updatedAt: now,
  }, { merge: true })
  for (const uid of [adminUid, clientUid]) {
    await adminDb.collection('orgMembers').doc(`${ORG_ID}_${uid}`).set(
      { uid, orgId: ORG_ID, role: 'owner', createdAt: now, updatedAt: now },
      { merge: true },
    )
  }

  await adminDb.collection(YOUTUBE_COLLECTIONS.channels).doc(CHANNEL_ID).set({
    orgId: ORG_ID, title: 'Dev Seed Channel', youtubeHandle: '@devseed',
    youtubeChannelId: 'UC_dev_seed', status: 'active', connectedAccountId: 'dev-seed-account',
    publishingReadiness: { readiness: 'ready', accountStatus: 'connected', apiProjectStatus: 'production', defaultUploadPrivacy: 'private' },
    contentPillars: ['Product', 'Tutorials'], avoidTopics: [],
    visibility: { showInClientPortal: true, showAnalytics: true },
    deleted: false, ...actor,
  }, { merge: true })

  const videos: Array<{ id: string; title: string; status: string; clientReview?: { status: string } }> = [
    { id: 'dev-seed-video-intake', title: 'Requested: launch teaser', status: 'intake' },
    { id: 'dev-seed-video-production', title: 'In production: onboarding walkthrough', status: 'production' },
    { id: 'dev-seed-video-review', title: 'Your review: feature deep-dive', status: 'client_review', clientReview: { status: 'requested' } },
    { id: 'dev-seed-video-ready', title: 'Ready: customer story', status: 'publish_ready' },
    { id: 'dev-seed-video-scheduled', title: 'Scheduled: Q3 roadmap', status: 'scheduled' },
    { id: 'dev-seed-video-live', title: 'Live: welcome to the channel', status: 'live' },
  ]
  for (const video of videos) {
    await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(video.id).set({
      orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, title: video.title,
      objective: 'Dev seed demo video', videoType: 'long_form', status: video.status,
      ...(video.clientReview ? { clientReview: video.clientReview } : {}),
      visibility: { showInClientPortal: true, showPublishingPacket: true },
      deleted: false, ...actor,
    }, { merge: true })
  }

  await adminDb.collection(YOUTUBE_COLLECTIONS.productionDrafts).doc('dev-seed-draft-review').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-review',
    title: 'Script v2 — feature deep-dive', draftType: 'script', status: 'client_review', versionNumber: 2,
    summary: 'Tighter hook, shorter intro.', hook: 'What if onboarding took 2 minutes?',
    outline: ['Hook', 'Problem', 'Demo', 'CTA'], scenes: [],
    visibility: { showInClientPortal: true }, deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(YOUTUBE_COLLECTIONS.renderJobs).doc('dev-seed-render-qa').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-review',
    title: 'Cut A — feature deep-dive', renderType: 'full_video', targetFormat: 'horizontal_16_9',
    status: 'qa_review', versionNumber: 1, editBrief: 'Fast cuts, captions on.', timeline: [],
    output: { previewUrl: 'https://example.com/dev-seed-preview.mp4', durationSeconds: 90 },
    visibility: { showInClientPortal: true }, deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(YOUTUBE_COLLECTIONS.packets).doc('dev-seed-packet-review').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-ready',
    status: 'client_review', versionNumber: 1, visibility: 'private',
    titleOptions: [{ text: 'Customer story: 3x output with PiB', selected: true }],
    description: 'How a client tripled content output.', tags: ['case study'], chapters: [],
    selfDeclaredMadeForKids: false, containsSyntheticMedia: false,
    deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).doc('dev-seed-asset-1').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-production',
    title: 'Raw screen recording', assetType: 'raw_footage', status: 'ready', durationSeconds: 640,
    visibility: { showInClientPortal: true }, deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects).doc('dev-seed-editor-project').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, title: 'Dev seed edit project',
    timeline: {
      version: 1,
      tracks: [
        { id: 'track-video-1', kind: 'video', label: 'Video', clips: [] },
        { id: 'track-text-1', kind: 'text', label: 'Text', clips: [{ id: 'title-1', timelineStart: 0, duration: 5, text: { content: 'Dev seed title', fontSizePx: 72, color: '#ffffff', align: 'center', animationPreset: 'none' }, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } }] },
      ],
    },
    deleted: false, ...actor,
  }, { merge: true })

  console.log('Dev seed complete.')
  console.log('  Org:      dev-seed-yt-org (Dev Seed Studio)')
  console.log('  Admin:    dev-admin@pib.local / dev-seed-password-1')
  console.log('  Client:   dev-client@pib.local / dev-seed-password-1')
  console.log('  Portal:   /portal/youtube-studio?orgId=dev-seed-yt-org')
  console.log('  Editor:   /portal/youtube-studio/editor/dev-seed-editor-project?orgId=dev-seed-yt-org')
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
