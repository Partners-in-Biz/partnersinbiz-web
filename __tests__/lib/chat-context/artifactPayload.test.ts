import { normalizeStudioArtifactPart } from '@/lib/chat-context/artifactPayload'
import { normalizeConversationOrigin } from '@/lib/chat-context/lineage'

describe('normalizeStudioArtifactPart', () => {
  it('keeps only stable artifact identities for a single artifact', () => {
    expect(normalizeStudioArtifactPart({
      type: 'studio_artifact',
      artifactId: ' marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE ',
      title: 'Stale title',
      snapshot: { status: 'stale' },
    })).toEqual({
      type: 'studio_artifact',
      artifactIds: ['marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE'],
    })
  })

  it('deduplicates a bounded bundle and rejects invalid identities', () => {
    expect(normalizeStudioArtifactPart({
      type: 'studio_artifact_bundle',
      artifactIds: ['a', 'b', 'a', '', 4],
    })).toEqual({ type: 'studio_artifact_bundle', artifactIds: ['a', 'b'] })
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact', artifactIds: [] })).toBeNull()
  })

  it('supports snake case, caps bundles at twenty, and drops oversized IDs', () => {
    const ids = Array.from({ length: 25 }, (_, index) => `artifact-${index}`)
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact_bundle', artifact_ids: ids })?.artifactIds).toHaveLength(20)
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact', artifact_id: 'x'.repeat(501) })).toBeNull()
  })
})

describe('conversationOrigin Firestore safety', () => {
  const valid = { conversationId: 'conv-1', requestMessageId: 'req-1', responseMessageId: 'res-1', bundleId: 'bundle-1', sequence: 0 }
  it.each([
    { ...valid, conversationId: 'bad/id' },
    { ...valid, requestMessageId: 'bad\u0000id' },
    { ...valid, responseMessageId: 'x'.repeat(201) },
    { ...valid, bundleId: 'bad/id' },
  ])('rejects unsafe IDs before persistence', (conversationOrigin) => {
    expect(normalizeConversationOrigin({ conversationOrigin })).toBeUndefined()
  })
})
