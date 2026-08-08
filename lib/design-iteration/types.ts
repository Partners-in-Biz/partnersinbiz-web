/**
 * Design Iteration ("Design this page") — types.
 *
 * P1 live-browser design iteration in Messages (task s1NikEl1bf4VGY0YuDzt,
 * project 2ZybgdBFW3un2Rt6pq0Y). The Impeccable Live Mode equivalent: the
 * agent launches the client's site in a workbench browser session, presents
 * a screenshot with numbered element refs, the user picks an element or types
 * freeform, the agent generates 2-3 archetype-distinct variants, the user
 * Accepts/Rejects via action buttons, and on Accept the agent writes the
 * change to the site repo (development branch, approved repo only), runs the
 * T1 detector, and reports the diff.
 *
 * This module is the pure data contract — org-scoped Firestore persistence
 * lives in `store.ts`, the Messages card in `iteration-card.ts`.
 */

export type DesignIterationVariantChangeType = 'dom-css' | 'image-mock'

export type DesignIterationVariantStatus = 'pending' | 'accepted' | 'rejected'

export type DesignIterationSessionStatus =
  | 'draft'
  | 'review'
  | 'accepted'
  | 'rejected'
  | 'applied'
  | 'failed'

/** A single design variant in the deck. */
export interface DesignIterationVariant {
  /** `v_`-prefixed stable id. */
  id: string
  /** Archetype label — the distinct direction this variant takes (e.g. "Bolder hero", "Sharp corners", "Quiet minimal"). */
  archetype: string
  /** Human-readable description of the change (DOM/CSS-level edit or image mock). */
  description: string
  changeType: DesignIterationVariantChangeType
  /** Hot-preview screenshot (workbench browser frame or image mock). */
  screenshotUrl?: string
  /** Short diff/summary of what would change in source (filled by the agent before Accept). */
  diffSummary?: string
  status: DesignIterationVariantStatus
  decisionNote?: string
  decidedBy?: string
  decidedAtMs?: number
  createdAtMs: number
}

/** Picked element ref(s) from the numbered screenshot the user chose. */
export interface DesignIterationElementRef {
  /** @eN-style ref from the workbench browser snapshot. */
  ref: string
  role?: string
  name?: string
}

/** Repo-write record, created only after an explicit Accept. */
export interface DesignIterationApply {
  repo: string
  branch: string
  commitSha?: string
  filesChanged: string[]
  diffSummary: string
  detectorExitCode?: number | null
  detectorFindings?: number
  detectorSummary?: string
  appliedAtMs: number
  appliedBy?: string
}

export interface DesignIterationSession {
  id: string
  orgId: string
  /** The page being designed. */
  url: string
  title?: string
  /** Workbench browser session id used to launch the page (`wbbs_`-prefixed). */
  browserSessionId?: string
  /** Baseline screenshot URL (hot-preview frame). */
  screenshotUrl?: string
  /** User instruction — freeform or element pick ("make the hero bolder, keep sharp corners"). */
  instruction: string
  /** Numbered element refs the user picked, when applicable. */
  elementRefs: DesignIterationElementRef[]
  variants: DesignIterationVariant[]
  status: DesignIterationSessionStatus
  acceptedVariantId?: string
  apply?: DesignIterationApply
  createdBy?: string
  createdAtMs: number
  updatedAtMs: number
  error?: string
}

export interface CreateDesignIterationSessionInput {
  orgId: string
  url: string
  title?: string
  browserSessionId?: string
  screenshotUrl?: string
  instruction: string
  elementRefs?: DesignIterationElementRef[]
  variants?: DesignIterationVariant[]
  createdBy?: string
  nowMs?: number
}

export interface AddDesignIterationVariantsInput {
  orgId: string
  sessionId: string
  variants: DesignIterationVariant[]
  nowMs?: number
}

export interface DecideDesignIterationVariantInput {
  orgId: string
  sessionId: string
  variantId: string
  decision: 'accept' | 'reject'
  decisionNote?: string
  decidedBy?: string
  nowMs?: number
}

export interface ApplyDesignIterationInput {
  orgId: string
  sessionId: string
  apply: DesignIterationApply
  nowMs?: number
}

/** Sanitizes a variant before storage (bounded strings, valid enum). */
export function cleanDesignIterationVariant(value: unknown, nowMs: number, index: number): DesignIterationVariant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const archetype = typeof raw.archetype === 'string' ? raw.archetype.trim().slice(0, 120) : ''
  const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 2_000) : ''
  if (!archetype || !description) return null
  const changeType = raw.changeType === 'image-mock' ? 'image-mock' : 'dom-css'
  const screenshotUrl = typeof raw.screenshotUrl === 'string' && raw.screenshotUrl.trim()
    ? raw.screenshotUrl.trim().slice(0, 2_048)
    : undefined
  const diffSummary = typeof raw.diffSummary === 'string' && raw.diffSummary.trim()
    ? raw.diffSummary.trim().slice(0, 4_000)
    : undefined
  return {
    id: typeof raw.id === 'string' && raw.id.startsWith('v_') ? raw.id.slice(0, 120) : `v_${nowMs}_${index}`,
    archetype,
    description,
    changeType,
    ...(screenshotUrl ? { screenshotUrl } : {}),
    ...(diffSummary ? { diffSummary } : {}),
    status: 'pending',
    createdAtMs: nowMs,
  }
}

/** True when the session's org owns it (tenant safety helper). */
export function designIterationOwnedBy(session: Pick<DesignIterationSession, 'orgId'>, orgId: string): boolean {
  return session.orgId === orgId
}
