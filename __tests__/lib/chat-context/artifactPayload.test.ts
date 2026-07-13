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
      artifacts: [{ id: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE', contextId: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE' }],
    })
  })

  it('deduplicates a bounded bundle and rejects invalid identities', () => {
    expect(normalizeStudioArtifactPart({
      type: 'studio_artifact_bundle',
      artifactIds: ['a', 'b', 'a', '', 4],
    })).toEqual({ type: 'studio_artifact_bundle', artifacts: [{ id: 'a', contextId: 'a' }, { id: 'b', contextId: 'b' }] })
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact', artifactIds: [] })).toBeNull()
  })

  it('supports snake case, caps bundles at twenty, and drops oversized IDs', () => {
    const ids = Array.from({ length: 25 }, (_, index) => `artifact-${index}`)
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact_bundle', artifact_ids: ids })?.artifacts).toHaveLength(20)
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact', artifact_id: 'x'.repeat(201) })).toBeNull()
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact', artifact_id: 'bad/id' })).toBeNull()
  })

  it('keeps an authoritative parent context locator for child artifacts and mixed bundles', () => {
    expect(normalizeStudioArtifactPart({
      type: 'studio_artifact_bundle',
      artifacts: [
        { id: 'video_editor:render:render-1', contextId: 'video_editor:project:project-1', title: 'stale' },
        { artifact_id: 'book_studio:cover_pdf:book-1:0', context_id: 'book_studio:project:book-1', preview: 'stale' },
      ],
    })).toEqual({
      type: 'studio_artifact_bundle',
      artifacts: [
        { id: 'video_editor:render:render-1', contextId: 'video_editor:project:project-1' },
        { id: 'book_studio:cover_pdf:book-1:0', contextId: 'book_studio:project:book-1' },
      ],
    })
  })

  it('rejects child locators without an authoritative parent and mismatched Studio namespaces', () => {
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact', artifacts: [{ id: 'video_editor:render:render-1' }] })).toBeNull()
    expect(normalizeStudioArtifactPart({ type: 'studio_artifact', artifacts: [{ id: 'video_editor:render:render-1', contextId: 'book_studio:project:book-1' }] })).toBeNull()
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
