import {
  buildWorldClassCertification,
  hasDurableCategoryEvidence,
  hasStructuredCollaborationProof,
  hasStructuredMobileProof,
  requiredCreativeCanvasProofCategories,
} from '@/lib/creative-canvas/parity-proof'

describe('creative canvas parity proof contracts', () => {
  const capturedAt = '2026-06-21T12:00:00.000Z'

  it('requires the five current content categories', () => {
    expect(requiredCreativeCanvasProofCategories.map((item) => item.key)).toEqual([
      'image',
      'video_social',
      'audio',
      'blog_document',
      'book',
    ])
  })

  it('rejects actor-only collaboration evidence', () => {
    expect(hasStructuredCollaborationProof({
      collaborationRemoteActorCount: 1,
      collaborationRemoteEventCount: 1,
      collaborationCapturedAt: capturedAt,
      collaborationEvidence: 'One remote actor joined.',
    })).toBe(false)
  })

  it('accepts typed remote mutation evidence with graph outcome', () => {
    expect(hasStructuredCollaborationProof({
      collaborationRemoteActorCount: 2,
      collaborationRemoteEventCount: 3,
      collaborationRemoteMutationCount: 2,
      collaborationRemoteMutationKindCount: 2,
      collaborationRemoteTouchedNodeCount: 2,
      collaborationRemoteGraphSignature: 'nodes:a,b|edges:a>b',
      collaborationRemoteSource: 'draft_applied',
      collaborationRemoteOutcome: 'remote_changes_adopted',
      collaborationCapturedAt: capturedAt,
      collaborationEvidence: '2 actors; 2 remote mutations; source draft_applied; outcome remote_changes_adopted.',
      collaborationRemoteMutations: [
        { actorUid: 'user-a', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'stream', occurredAt: capturedAt },
        { actorUid: 'agent-maya', actorType: 'agent', operation: 'edge_add', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], source: 'draft_applied', occurredAt: capturedAt },
      ],
    })).toBe(true)
  })

  it('rejects screenshot-only mobile evidence', () => {
    expect(hasStructuredMobileProof({
      mobileViewportProofCount: 4,
      mobileViewportRequiredCount: 4,
      mobileViewportProofCapturedAt: capturedAt,
      mobileViewportEvidence: '4/4 screenshots captured.',
    })).toBe(false)
  })

  it('accepts signed-in mobile behavior evidence for all required viewports', () => {
    expect(hasStructuredMobileProof({
      mobileViewportProofCount: 4,
      mobileViewportRequiredCount: 4,
      mobileViewportProofCapturedAt: capturedAt,
      mobileViewportEvidence: '4/4 viewport behavior proofs captured.',
      mobileViewportBehaviorEvidence: [
        { key: 'desktop', width: 1440, height: 980, screenshotUrl: 'https://proof.example.com/desktop.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector', 'runs'], capturedAt },
        { key: 'tablet', width: 820, height: 1180, screenshotUrl: 'https://proof.example.com/tablet.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector'], capturedAt },
        { key: 'mobile', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'], capturedAt },
        { key: 'mobile_panels', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile-panels.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['inspector', 'runs', 'exports'], capturedAt },
      ],
    })).toBe(true)
  })

  it('requires durable category evidence instead of aggregate runtime counts', () => {
    expect(hasDurableCategoryEvidence({
      runtimeProviderBackedCategoryCount: 5,
      runtimeProviderBackedCompletedCount: 10,
      runtimeProviderEvidenceCapturedAt: capturedAt,
      runtimeProviderEvidence: '5/5 categories passed.',
    })).toBe(false)
  })

  it('returns blocked certification until every world-class gate is green', () => {
    const certification = buildWorldClassCertification({
      benchmarkProofs: [],
      runtimeProof: undefined,
      liveProofArtifacts: [],
      requiredBenchmarkCount: 10,
      capturedAt,
    })
    expect(certification.status).toBe('blocked')
    expect(certification.blockers).toContain('Missing 10 source-backed benchmark proofs.')
  })
})
