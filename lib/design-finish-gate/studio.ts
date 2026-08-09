/**
 * Studio artifact review — extend the Studio review tooling (research P2:
 * "Studio review tooling to extend") so a creative-canvas artifact can be
 * finish-gated like any web surface.
 *
 * A Studio node's data bag may carry HTML-like payloads (email blocks, blog
 * bodies, SEO content) plus an existing designAudit stamp from the T5 slop
 * gate. This module turns that into a ReviewContract: the designAudit
 * findings become evidence, the node's HTML payloads are rendered to a
 * throwaway preview (when a path is supplied) and screenshotted, and the
 * promise list comes from the task brief or the artifact's own fields.
 */

import { extractHtmlPayloads, type StudioAuditStamp } from '../design-audit/studio'
import { buildContract, type BuildContractInput } from './contract'
import type { ReviewContract } from './types'

export interface StudioReviewInput {
  nodeId: string
  data: Record<string, unknown>
  brief: string
  title?: string
  taskId?: string
  projectId?: string
  orgId?: string
  builderAgentId: string
  /** Existing designAudit stamp (from lib/design-audit/studio.ts T5). */
  designAudit?: StudioAuditStamp | null
  /** Screenshot evidence of the artifact (rendered previews etc). */
  screenshots?: string[]
  maxFixRounds?: number
  round?: number
}

/**
 * Build a finish-gate contract for a Studio artifact. The designAudit stamp
 * (when present) is attached to the brief as evidence so the fresh reviewer
 * sees the detector's P0-P3 findings alongside the screenshots.
 */
export function buildStudioReviewContract(input: StudioReviewInput): ReviewContract {
  const htmlFields = extractHtmlPayloads(input.data)
  const auditBlock = input.designAudit
    ? `\n\n## Existing design-audit stamp (T5 slop gate)\n${JSON.stringify(input.designAudit, null, 2).slice(0, 4000)}`
    : ''
  const htmlBlock = htmlFields.length
    ? `\n\n## Artifact HTML payloads (field → excerpt)\n${htmlFields
        .map((f) => `- ${f.field}: ${f.html.slice(0, 300).replace(/\s+/g, ' ')}`)
        .join('\n')
        .slice(0, 4000)}`
    : ''

  const contractInput: BuildContractInput = {
    taskId: input.taskId,
    projectId: input.projectId,
    orgId: input.orgId,
    title: input.title ?? `Studio artifact ${input.nodeId}`,
    brief: `${input.brief}${auditBlock}${htmlBlock}`,
    screenshots: input.screenshots,
    builderAgentId: input.builderAgentId,
    round: input.round,
    maxFixRounds: input.maxFixRounds,
  }
  return buildContract(contractInput)
}
