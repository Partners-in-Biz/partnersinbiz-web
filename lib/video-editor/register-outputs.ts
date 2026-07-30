import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeSourceAssetInput } from '@/lib/youtube-studio/sanitize'
import type { VideoEditorProject, VideoEditorProjectSettings, VideoEditorRenderJobOutput } from './types'

/**
 * Ownership stays with the project owner (human who asked for the render).
 * Agent identity is recorded on *AgentId fields, never as the ACL owner.
 */
function outputActorFields(
  project: Pick<VideoEditorProject, 'createdBy' | 'createdByType'>,
  options: { includeCreated?: boolean } = {},
) {
  const ownerUid =
    typeof project.createdBy === 'string' && project.createdBy.trim() && project.createdByType !== 'agent'
      ? project.createdBy.trim()
      : 'agent:pip'
  const ownerIsAgent = ownerUid.startsWith('agent:') || project.createdByType === 'agent'
  return {
    updatedBy: ownerUid,
    updatedByType: ownerIsAgent ? 'agent' as const : 'user' as const,
    updatedByAgentId: 'pip',
    updatedAt: FieldValue.serverTimestamp(),
    ...(options.includeCreated === false ? {} : {
      createdBy: ownerUid,
      createdByType: ownerIsAgent ? 'agent' as const : 'user' as const,
      createdByAgentId: 'pip',
      createdAt: FieldValue.serverTimestamp(),
    }),
  }
}

function mediaFormatFor(settings: VideoEditorProjectSettings): 'horizontal' | 'vertical' | 'square' {
  if (settings.aspect === '9:16') return 'vertical'
  if (settings.aspect === '1:1') return 'square'
  return 'horizontal'
}

export interface VideoEditorOutputRegistration {
  youtubeSourceAssetId?: string
  canvasUploadId?: string
}

export async function registerVideoEditorRenderOutputs(
  jobId: string,
  project: VideoEditorProject & { id: string },
  output: VideoEditorRenderJobOutput,
  settings: VideoEditorProjectSettings,
): Promise<VideoEditorOutputRegistration> {
  const registration: VideoEditorOutputRegistration = {}
  const assetId = `video-editor-${jobId}`
  const provenanceNote = `video editor render job ${jobId}, project ${project.id}`

  if (project.channelWorkspaceId) {
    const assetData = sanitizeYouTubeSourceAssetInput({
      orgId: project.orgId,
      channelWorkspaceId: project.channelWorkspaceId,
      ...(project.videoProjectId ? { videoProjectId: project.videoProjectId } : {}),
      title: `Editor render: ${project.title}`,
      assetType: 'rendered_video',
      status: 'ready',
      mediaFormat: mediaFormatFor(settings),
      sourceUrl: output.url,
      internalNotes: provenanceNote,
    })
    const assetRef = adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).doc(assetId)
    const existingAsset = await assetRef.get()
    await assetRef.set({
      ...assetData,
      deleted: false,
      ...outputActorFields(project, { includeCreated: !existingAsset.exists }),
    }, { merge: true })
    registration.youtubeSourceAssetId = assetId
  }

  if (project.canvasId) {
    const uploadRef = adminDb.collection('uploads').doc(assetId)
    const existingUpload = await uploadRef.get()
    await uploadRef.set({
      orgId: project.orgId,
      name: `${project.title} (${settings.width}x${settings.height}).mp4`,
      filename: `${jobId}.mp4`,
      storagePath: output.storagePath,
      url: output.url,
      previewUrl: output.url,
      mimeType: 'video/mp4',
      ...(typeof output.sizeBytes === 'number' ? { size: output.sizeBytes } : {}),
      folder: `video-editor/${project.orgId}/${project.id}`,
      source: 'video_editor',
      altText: provenanceNote,
      relatedTo: { type: 'creative_canvas', id: project.canvasId },
      deleted: false,
      ...outputActorFields(project, { includeCreated: !existingUpload.exists }),
    }, { merge: true })
    registration.canvasUploadId = assetId
  }

  // Kick off waveform/filmstrip/proxy generation for the fresh render so it is
  // scrub-ready when re-imported into a timeline. Never blocks registration.
  try {
    const { ensureMediaPreviews } = await import('./media-previews-server')
    const previewActorUid =
      typeof project.createdBy === 'string' && project.createdBy.trim() && project.createdByType !== 'agent'
        ? project.createdBy.trim()
        : 'agent:pip'
    await ensureMediaPreviews(project.orgId, [
      { type: 'youtube_source_asset', sourceAssetId: `video-editor-${jobId}`, url: output.url, mediaKind: 'video' },
    ], {
      uid: previewActorUid,
      role: previewActorUid.startsWith('agent:') ? 'ai' : 'client',
      authKind: previewActorUid.startsWith('agent:') ? 'agent_api_key' : 'session',
      agentId: 'pip',
    })
  } catch (error) {
    console.error('[video-editor] media preview enqueue failed:', error)
  }

  return registration
}
