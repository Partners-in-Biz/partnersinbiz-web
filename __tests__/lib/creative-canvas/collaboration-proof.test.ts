import { collectCollaborationMutationProof } from '@/lib/creative-canvas/collaboration-proof'
import { hasStructuredCollaborationProof } from '@/lib/creative-canvas/parity-proof'

describe('collectCollaborationMutationProof', () => {
  const capturedAt = '2026-06-21T12:30:00.000Z'

  it('does not accept remote presence without a typed mutation', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [{ actorUid: 'user-2', actorType: 'user', hasUnsavedGraphChanges: true, graphSignature: 'draft-only' }],
      activity: [],
      latestAppliedDraft: undefined,
      currentGraphSignature: 'current',
      streamConnected: true,
      capturedAt,
      binding: {
        orgId: 'org-1',
        canvasVersion: 3,
        graphSignature: 'current',
        nodeCount: 2,
        edgeCount: 1,
      },
    })

    expect(hasStructuredCollaborationProof(proof)).toBe(false)
    expect(proof.collaborationEvidence).toContain('0 typed remote mutations')
  })

  it('does not accept draft availability until the draft is applied or conflict-handled', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [{ actorUid: 'user-2', actorType: 'user', hasUnsavedGraphChanges: true, graphSignature: 'remote-draft' }],
      activity: [{ actorUid: 'user-2', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'poll', occurredAt: capturedAt }],
      latestAppliedDraft: undefined,
      currentGraphSignature: 'current',
      streamConnected: false,
      capturedAt,
      binding: {
        orgId: 'org-1',
        canvasVersion: 3,
        graphSignature: 'current',
        nodeCount: 2,
        edgeCount: 0,
      },
    })

    expect(hasStructuredCollaborationProof(proof)).toBe(false)
    expect(proof.collaborationRemoteOutcome).toBe('remote_changes_observed')
  })

  it('accepts an applied remote draft with touched nodes and graph signature', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [
        { actorUid: 'user-2', actorType: 'user', hasUnsavedGraphChanges: false, graphSignature: 'after-apply' },
        { actorUid: 'agent-maya', actorType: 'agent', hasUnsavedGraphChanges: false, graphSignature: 'after-apply' },
      ],
      activity: [
        { actorUid: 'user-2', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'stream', occurredAt: capturedAt },
        { actorUid: 'agent-maya', actorType: 'agent', operation: 'edge_add', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], source: 'draft_applied', occurredAt: capturedAt },
      ],
      latestAppliedDraft: { actorUid: 'agent-maya', actorType: 'agent', graphSignature: 'after-apply', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], appliedAt: capturedAt },
      currentGraphSignature: 'after-apply',
      streamConnected: true,
      capturedAt,
      binding: {
        orgId: 'org-1',
        canvasVersion: 4,
        graphSignature: 'after-apply',
        nodeCount: 2,
        edgeCount: 1,
      },
    })

    expect(hasStructuredCollaborationProof(proof)).toBe(true)
    expect(proof.collaborationRemoteMutationKindCount).toBe(3)
    expect(proof.collaborationRemoteTouchedNodeCount).toBe(2)
    expect(proof.collaborationRemoteOutcome).toBe('remote_changes_adopted')
  })

  it('accepts an adopted draft even without separate activity rows', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [
        { actorUid: 'observer-1', actorType: 'user', hasUnsavedGraphChanges: false, graphSignature: 'after-apply' },
      ],
      activity: [],
      latestAppliedDraft: {
        actorUid: 'agent-maya',
        actorType: 'agent',
        graphSignature: 'after-apply',
        touchedNodeIds: ['node-a', 'node-b'],
        touchedEdgeIds: ['edge-a-b'],
        appliedAt: capturedAt,
      },
      currentGraphSignature: 'after-apply',
      streamConnected: true,
      capturedAt,
      binding: {
        orgId: 'org-1',
        canvasVersion: 5,
        graphSignature: 'after-apply',
        nodeCount: 2,
        edgeCount: 1,
      },
    })

    expect(hasStructuredCollaborationProof(proof)).toBe(true)
    expect(proof.collaborationRemoteActorCount).toBe(1)
    expect(proof.collaborationRemoteMutationCount).toBe(1)
    expect(proof.collaborationRemoteMutationKindCount).toBe(1)
    expect(proof.collaborationRemoteMutations).toEqual([{
      actorUid: 'agent-maya',
      actorType: 'agent',
      operation: 'draft_apply',
      touchedNodeIds: ['node-a', 'node-b'],
      touchedEdgeIds: ['edge-a-b'],
      source: 'draft_applied',
      occurredAt: capturedAt,
    }])
  })

  it('ignores passive observer presence when counting mutating actors', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [
        { actorUid: 'observer-1', actorType: 'user', hasUnsavedGraphChanges: false, graphSignature: 'after-apply' },
        { actorUid: 'agent-maya', actorType: 'agent', hasUnsavedGraphChanges: false, graphSignature: 'after-apply' },
      ],
      activity: [],
      latestAppliedDraft: {
        actorUid: 'agent-maya',
        actorType: 'agent',
        graphSignature: 'after-apply',
        touchedNodeIds: ['node-a'],
        touchedEdgeIds: [],
        appliedAt: capturedAt,
      },
      currentGraphSignature: 'after-apply',
      streamConnected: true,
      capturedAt,
      binding: {
        orgId: 'org-1',
        canvasVersion: 6,
        graphSignature: 'after-apply',
        nodeCount: 2,
        edgeCount: 0,
      },
    })

    expect(hasStructuredCollaborationProof(proof)).toBe(true)
    expect(proof.collaborationRemoteActorCount).toBe(1)
    expect(proof.collaborationRemoteMutationCount).toBe(1)
    expect(proof.collaborationRemoteMutations).toEqual([{
      actorUid: 'agent-maya',
      actorType: 'agent',
      operation: 'draft_apply',
      touchedNodeIds: ['node-a'],
      touchedEdgeIds: [],
      source: 'draft_applied',
      occurredAt: capturedAt,
    }])
  })
})
