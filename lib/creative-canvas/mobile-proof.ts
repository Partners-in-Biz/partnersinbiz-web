import type {
  CreativeCanvasMobileProof,
  CreativeCanvasMobileViewportEvidence,
  CreativeCanvasProofBinding,
} from './types'

type ViewportInput = Omit<CreativeCanvasMobileViewportEvidence, 'capturedAt'>

const requiredViewportKeys: CreativeCanvasMobileViewportEvidence['key'][] = ['desktop', 'tablet', 'mobile', 'mobile_panels']

function isFailedViewport(item: CreativeCanvasMobileViewportEvidence): boolean {
  return item.status < 200
    || item.status >= 400
    || !item.contentType.startsWith('image/')
    || !item.criticalControlsVisible
    || !item.criticalControlsEnabled
    || item.horizontalOverflow
    || !item.touchSmokePassed
    || !item.pointerSmokePassed
    || item.panelKeys.length === 0
}

export function buildMobileViewportBehaviorProof(input: CreativeCanvasProofBinding & {
  viewports: ViewportInput[]
  capturedAt: string
}): CreativeCanvasMobileProof {
  const evidence = input.viewports.map((item) => ({
    ...item,
    capturedAt: input.capturedAt,
  }))
  const covered = new Set(evidence.map((item) => item.key))
  const missing = requiredViewportKeys.filter((key) => !covered.has(key))
  const failing = evidence.filter(isFailedViewport)
  const failureText = [
    ...missing.map((key) => `${key} missing`),
    ...failing.map((item) => `${item.key}${item.horizontalOverflow ? ' overflow' : ' behavior incomplete'}`),
  ]

  return {
    orgId: input.orgId,
    canvasVersion: input.canvasVersion,
    graphSignature: input.graphSignature,
    nodeCount: input.nodeCount,
    edgeCount: input.edgeCount,
    mobileViewportProofCount: evidence.length,
    mobileViewportRequiredCount: requiredViewportKeys.length,
    mobileViewportProofCapturedAt: input.capturedAt,
    mobileViewportEvidence: failureText.length
      ? `${evidence.length}/${requiredViewportKeys.length} signed-in viewport behavior proofs captured; ${failureText.join(', ')}.`
      : `${evidence.length}/${requiredViewportKeys.length} signed-in viewport behavior proofs captured with controls visible, enabled, touch/pointer smoke passed, and no horizontal overflow.`,
    mobileViewportBehaviorEvidence: evidence,
  }
}
