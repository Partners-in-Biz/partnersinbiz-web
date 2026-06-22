import { buildMobileViewportBehaviorProof } from '@/lib/creative-canvas/mobile-proof'
import { hasStructuredMobileProof } from '@/lib/creative-canvas/parity-proof'
import type { CreativeCanvasProofBinding } from '@/lib/creative-canvas/types'

describe('buildMobileViewportBehaviorProof', () => {
  const capturedAt = '2026-06-21T13:00:00.000Z'
  const binding: CreativeCanvasProofBinding = {
    orgId: 'org-1',
    canvasVersion: 3,
    graphSignature: 'graph-signature-123',
    nodeCount: 6,
    edgeCount: 5,
  }

  it('blocks when any viewport has horizontal overflow', () => {
    const proof = buildMobileViewportBehaviorProof({
      ...binding,
      capturedAt,
      viewports: [
        { key: 'desktop', width: 1440, height: 980, screenshotUrl: 'https://proof.example.com/desktop.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'tablet', width: 820, height: 1180, screenshotUrl: 'https://proof.example.com/tablet.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: true, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'mobile', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'mobile_panels', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile-panels.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['inspector'] },
      ],
    })

    expect(hasStructuredMobileProof(proof, binding)).toBe(false)
    expect(proof.mobileViewportEvidence).toContain('tablet overflow')
  })

  it('passes with all four signed-in viewport behaviors', () => {
    const proof = buildMobileViewportBehaviorProof({
      ...binding,
      capturedAt,
      viewports: [
        { key: 'desktop', width: 1440, height: 980, screenshotUrl: 'https://proof.example.com/desktop.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector', 'runs'] },
        { key: 'tablet', width: 820, height: 1180, screenshotUrl: 'https://proof.example.com/tablet.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector'] },
        { key: 'mobile', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'mobile_panels', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile-panels.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['inspector', 'runs', 'exports'] },
      ],
    })

    expect(hasStructuredMobileProof(proof, binding)).toBe(true)
    expect(proof.mobileViewportProofCount).toBe(4)
    expect(proof.mobileViewportEvidence).toContain('4/4 signed-in viewport behavior proofs')
    expect(proof).toMatchObject(binding)
  })
})
