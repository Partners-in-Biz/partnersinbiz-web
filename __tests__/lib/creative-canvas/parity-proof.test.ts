import {
  buildWorldClassCertification,
  hasDurableCategoryEvidence,
  hasStructuredCollaborationProof,
  hasStructuredMobileProof,
  requiredCreativeCanvasProofCategories,
} from '@/lib/creative-canvas/parity-proof'

describe('creative canvas parity proof contracts', () => {
  const capturedAt = '2026-06-21T12:00:00.000Z'
  const currentBinding = {
    orgId: 'org-123',
    canvasVersion: 7,
    graphSignature: 'nodes:a,b|edges:a>b',
    nodeCount: 2,
    edgeCount: 1,
  }

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
      ...currentBinding,
      collaborationRemoteActorCount: 1,
      collaborationRemoteEventCount: 1,
      collaborationCapturedAt: capturedAt,
      collaborationEvidence: 'One remote actor joined.',
    })).toBe(false)
  })

  it('accepts typed remote mutation evidence with graph outcome', () => {
    expect(hasStructuredCollaborationProof({
      ...currentBinding,
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
    }, currentBinding)).toBe(true)
  })

  it('rejects remote changes observed even when the rest of the collaboration proof is complete', () => {
    expect(hasStructuredCollaborationProof({
      ...currentBinding,
      collaborationRemoteActorCount: 2,
      collaborationRemoteEventCount: 3,
      collaborationRemoteMutationCount: 2,
      collaborationRemoteMutationKindCount: 2,
      collaborationRemoteTouchedNodeCount: 2,
      collaborationRemoteGraphSignature: currentBinding.graphSignature,
      collaborationRemoteSource: 'draft_applied',
      collaborationRemoteOutcome: 'remote_changes_observed',
      collaborationCapturedAt: capturedAt,
      collaborationEvidence: 'Remote changes were only observed.',
      collaborationRemoteMutations: [
        { actorUid: 'user-a', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'stream', occurredAt: capturedAt },
        { actorUid: 'agent-maya', actorType: 'agent', operation: 'edge_add', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], source: 'draft_applied', occurredAt: capturedAt },
      ],
    }, currentBinding)).toBe(false)
  })

  it('rejects collaboration proof when the current graph binding does not match', () => {
    expect(hasStructuredCollaborationProof({
      orgId: currentBinding.orgId,
      canvasVersion: currentBinding.canvasVersion,
      graphSignature: currentBinding.graphSignature,
      nodeCount: currentBinding.nodeCount,
      edgeCount: currentBinding.edgeCount,
      collaborationRemoteActorCount: 2,
      collaborationRemoteEventCount: 3,
      collaborationRemoteMutationCount: 2,
      collaborationRemoteMutationKindCount: 2,
      collaborationRemoteTouchedNodeCount: 2,
      collaborationRemoteGraphSignature: currentBinding.graphSignature,
      collaborationRemoteSource: 'draft_applied',
      collaborationRemoteOutcome: 'remote_changes_adopted',
      collaborationCapturedAt: capturedAt,
      collaborationEvidence: 'Complete-looking proof with stale binding.',
      collaborationRemoteMutations: [
        { actorUid: 'user-a', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'stream', occurredAt: capturedAt },
        { actorUid: 'agent-maya', actorType: 'agent', operation: 'edge_add', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], source: 'draft_applied', occurredAt: capturedAt },
      ],
    }, { ...currentBinding, canvasVersion: currentBinding.canvasVersion + 1 })).toBe(false)
  })

  it('rejects screenshot-only mobile evidence', () => {
    expect(hasStructuredMobileProof({
      ...currentBinding,
      mobileViewportProofCount: 4,
      mobileViewportRequiredCount: 4,
      mobileViewportProofCapturedAt: capturedAt,
      mobileViewportEvidence: '4/4 screenshots captured.',
    })).toBe(false)
  })

  it('rejects signed-in mobile behavior evidence when current canvas binding is missing', () => {
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
    }, currentBinding)).toBe(false)
  })

  it('accepts signed-in mobile behavior evidence for all required viewports', () => {
    expect(hasStructuredMobileProof({
      ...currentBinding,
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

  it('rejects category evidence when required current canvas binding is missing', () => {
    const missingBindingExportEvidence = requiredCreativeCanvasProofCategories.map((category) => {
      const proof = {
        ...currentBinding,
        categoryKey: category.key,
        runIds: ['run-1', 'run-2'],
        providerJobIds: category.requiresProviderJobId ? ['job-1'] : [],
        outputUrls: ['https://proof.example.com/output'],
        artifactIds: ['artifact-1'],
        outputNodeIds: ['output-node-1'],
        exportIds: ['export-1'],
        downstreamDraftIds: ['draft-1'],
        lineageSourceNodeIds: ['source-1'],
        providerKeys: ['higgsfield'],
        outputKinds: ['image'],
        reviewStatuses: ['passed'],
        completedAt: capturedAt,
        evidence: 'Durable export evidence.',
      }

      if (category.key !== 'book') {
        return proof
      }

      const { graphSignature: _graphSignature, ...withoutGraphSignature } = proof
      return withoutGraphSignature as typeof proof
    })

    expect(hasDurableCategoryEvidence({
      runtimeCategoryEvidence: requiredCreativeCanvasProofCategories.map((category) => ({
        ...currentBinding,
        categoryKey: category.key,
        runIds: ['run-1', 'run-2'],
        providerJobIds: category.requiresProviderJobId ? ['job-1'] : [],
        outputUrls: ['https://proof.example.com/output'],
        artifactIds: ['artifact-1'],
        outputNodeIds: ['output-node-1'],
        exportIds: ['export-1'],
        downstreamDraftIds: ['draft-1'],
        lineageSourceNodeIds: ['source-1'],
        providerKeys: ['higgsfield'],
        outputKinds: ['image'],
        reviewStatuses: ['passed'],
        completedAt: capturedAt,
        evidence: 'Durable runtime evidence.',
      })),
      exportCategoryEvidence: missingBindingExportEvidence,
    }, currentBinding)).toBe(false)
  })

  it('rejects category evidence when required current canvas binding does not match', () => {
    expect(hasDurableCategoryEvidence({
      runtimeCategoryEvidence: requiredCreativeCanvasProofCategories.map((category) => ({
        ...currentBinding,
        categoryKey: category.key,
        runIds: ['run-1', 'run-2'],
        providerJobIds: category.requiresProviderJobId ? ['job-1'] : [],
        outputUrls: ['https://proof.example.com/output'],
        artifactIds: ['artifact-1'],
        outputNodeIds: ['output-node-1'],
        exportIds: ['export-1'],
        downstreamDraftIds: ['draft-1'],
        lineageSourceNodeIds: ['source-1'],
        providerKeys: ['higgsfield'],
        outputKinds: ['image'],
        reviewStatuses: ['passed'],
        completedAt: capturedAt,
        evidence: 'Durable runtime evidence.',
      })),
      exportCategoryEvidence: requiredCreativeCanvasProofCategories.map((category) => ({
        ...currentBinding,
        categoryKey: category.key,
        runIds: ['run-1', 'run-2'],
        providerJobIds: category.requiresProviderJobId ? ['job-1'] : [],
        outputUrls: ['https://proof.example.com/output'],
        artifactIds: ['artifact-1'],
        outputNodeIds: ['output-node-1'],
        exportIds: ['export-1'],
        downstreamDraftIds: ['draft-1'],
        lineageSourceNodeIds: ['source-1'],
        providerKeys: ['higgsfield'],
        outputKinds: ['image'],
        reviewStatuses: ['passed'],
        completedAt: capturedAt,
        evidence: 'Durable export evidence.',
      })),
    }, { ...currentBinding, graphSignature: 'nodes:a,b,c|edges:a>b,b>c' })).toBe(false)
  })

  it('returns blocked certification until every world-class gate is green', () => {
    const certification = buildWorldClassCertification({
      benchmarkProofs: [],
      runtimeProof: undefined,
      liveProofArtifacts: [],
      requiredBenchmarkCount: 10,
      capturedAt,
      currentBinding,
    })
    expect(certification.status).toBe('blocked')
    expect(certification.blockers).toContain('Missing 10 source-backed benchmark proofs.')
  })

  it('keeps certification blocked when current binding is omitted', () => {
    const certification = buildWorldClassCertification({
      benchmarkProofs: Array.from({ length: 2 }, (_, index) => ({
        key: `benchmark-${index + 1}`,
        passed: true,
        evidence: `Benchmark ${index + 1} passed.`,
      })),
      runtimeProof: { status: 'passed', readyForLiveProof: true },
      liveProofArtifacts: [
        'https://proof.example.com/live-1',
        'https://proof.example.com/live-2',
        'https://proof.example.com/live-3',
        'https://proof.example.com/live-4',
      ],
      requiredBenchmarkCount: 2,
      capturedAt,
      signedInPreviewProof: {
        ...currentBinding,
        passed: true,
        evidence: 'Preview confirmed against signed-in Vercel Preview.',
        artifactRef: 'preview-artifact-1',
        capturedAt,
      },
      kbCertification: {
        ...currentBinding,
        recorded: true,
        evidence: 'KB certification recorded in partner wiki.',
        artifactRef: 'kb-artifact-1',
        capturedAt,
      },
    })

    expect(certification.status).toBe('blocked')
    expect(certification.blockers).toContain('Current canvas binding is missing or invalid.')
  })

  it('keeps certification blocked when preview and kb evidence references are missing', () => {
    const certification = buildWorldClassCertification({
      benchmarkProofs: Array.from({ length: 2 }, (_, index) => ({
        key: `benchmark-${index + 1}`,
        passed: true,
        evidence: `Benchmark ${index + 1} passed.`,
      })),
      runtimeProof: { status: 'passed', readyForLiveProof: true },
      liveProofArtifacts: [
        'https://proof.example.com/live-1',
        'https://proof.example.com/live-2',
        'https://proof.example.com/live-3',
        'https://proof.example.com/live-4',
      ],
      requiredBenchmarkCount: 2,
      capturedAt,
      currentBinding,
      signedInPreviewProof: {
        ...currentBinding,
        passed: true,
        capturedAt,
      },
      kbCertification: {
        ...currentBinding,
        recorded: true,
        capturedAt,
      },
    })

    expect(certification.status).toBe('blocked')
    expect(certification.blockers).toContain('Signed-in Vercel Preview proof evidence is incomplete.')
    expect(certification.blockers).toContain('KB-recorded certification evidence is incomplete.')
  })

  it('returns passed certification only when bound preview and kb artifacts are present', () => {
    const certification = buildWorldClassCertification({
      benchmarkProofs: Array.from({ length: 2 }, (_, index) => ({
        key: `benchmark-${index + 1}`,
        passed: true,
        evidence: `Benchmark ${index + 1} passed.`,
      })),
      runtimeProof: { status: 'passed', readyForLiveProof: true },
      liveProofArtifacts: [
        'https://proof.example.com/live-1',
        'https://proof.example.com/live-2',
        'https://proof.example.com/live-3',
        'https://proof.example.com/live-4',
      ],
      requiredBenchmarkCount: 2,
      capturedAt,
      currentBinding,
      signedInPreviewProof: {
        ...currentBinding,
        passed: true,
        evidence: 'Preview confirmed against signed-in Vercel Preview.',
        artifactRef: 'preview-artifact-1',
        capturedAt,
      },
      kbCertification: {
        ...currentBinding,
        recorded: true,
        evidence: 'KB certification recorded in partner wiki.',
        artifactRef: 'kb-artifact-1',
        capturedAt,
      },
    })

    expect(certification.status).toBe('passed')
    expect(certification.signedInPreviewProofPassed).toBe(true)
    expect(certification.signedInPreviewProofArtifactRef).toBe('preview-artifact-1')
    expect(certification.kbCertificationRecorded).toBe(true)
    expect(certification.kbCertificationArtifactRef).toBe('kb-artifact-1')
  })
})
