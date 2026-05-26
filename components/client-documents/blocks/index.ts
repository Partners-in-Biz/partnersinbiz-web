import type { FC } from 'react'
import type { DocumentBlock, DocumentBlockType } from '@/lib/client-documents/types'
import { UnknownBlock } from './UnknownBlock'
import { UnknownEditor } from './editors/UnknownEditor'
import { HeroBlock } from './HeroBlock'
import { HeroEditor } from './editors/HeroEditor'
import { SummaryBlock } from './SummaryBlock'
import { SummaryEditor } from './editors/SummaryEditor'
import { ProblemBlock } from './ProblemBlock'
import { ProblemEditor } from './editors/ProblemEditor'
import { ScopeBlock } from './ScopeBlock'
import { ScopeEditor } from './editors/ScopeEditor'
import { DeliverablesBlock } from './DeliverablesBlock'
import { DeliverablesEditor } from './editors/DeliverablesEditor'
import { TermsBlock } from './TermsBlock'
import { TermsEditor } from './editors/TermsEditor'
import { ApprovalBlock } from './ApprovalBlock'
import { ApprovalEditor } from './editors/ApprovalEditor'
import { RichTextBlock } from './RichTextBlock'
import { RichTextEditor } from './editors/RichTextEditor'
import { TimelineBlock } from './TimelineBlock'
import { TimelineEditor } from './editors/TimelineEditor'
import { InvestmentBlock } from './InvestmentBlock'
import { InvestmentEditor } from './editors/InvestmentEditor'
import { MetricsBlock } from './MetricsBlock'
import { MetricsEditor } from './editors/MetricsEditor'
import { RiskBlock } from './RiskBlock'
import { RiskEditor } from './editors/RiskEditor'
import { TableBlock } from './TableBlock'
import { TableEditor } from './editors/TableEditor'
import { GalleryBlock } from './GalleryBlock'
import { GalleryEditor } from './editors/GalleryEditor'
import { CalloutBlock } from './CalloutBlock'
import { CalloutEditor } from './editors/CalloutEditor'
import { ImageBlock } from './ImageBlock'
import { ImageEditor } from './editors/ImageEditor'
import { VideoBlock } from './VideoBlock'
import { VideoEditor } from './editors/VideoEditor'
import { EmbedBlock } from './EmbedBlock'
import { EmbedEditor } from './editors/EmbedEditor'
import { LinkCardBlock } from './LinkCardBlock'
import { LinkCardEditor } from './editors/LinkCardEditor'
import { ChartBlock } from './ChartBlock'
import { ChartEditor } from './editors/ChartEditor'
import { PricingToggleBlock } from './PricingToggleBlock'
import { PricingToggleEditor } from './editors/PricingToggleEditor'
import { FaqBlock } from './FaqBlock'
import { FaqEditor } from './editors/FaqEditor'
import { ComparisonBlock } from './ComparisonBlock'
import { ComparisonEditor } from './editors/ComparisonEditor'
import {
  BeforeAfterBlock,
  CaseStudyResultCardsBlock,
  FunnelBlock,
  LogoTestimonialProofBlock,
  QuadrantMatrixBlock,
  RadarBlock,
  RoadmapGanttBlock,
  WeightedDecisionMatrixBlock,
} from './ShowcaseBlocks'

type RendererProps = { block: DocumentBlock; index: number }
type EditorProps = { block: DocumentBlock; onChange: (b: DocumentBlock) => void }

export const BLOCK_RENDERERS: Partial<Record<DocumentBlockType, FC<RendererProps>>> = {
  hero: HeroBlock,
  summary: SummaryBlock,
  problem: ProblemBlock,
  scope: ScopeBlock,
  deliverables: DeliverablesBlock,
  terms: TermsBlock,
  approval: ApprovalBlock,
  rich_text: RichTextBlock,
  timeline: TimelineBlock,
  investment: InvestmentBlock,
  metrics: MetricsBlock,
  risk: RiskBlock,
  table: TableBlock,
  gallery: GalleryBlock,
  callout: CalloutBlock,
  image: ImageBlock,
  video: VideoBlock,
  embed: EmbedBlock,
  link_card: LinkCardBlock,
  chart: ChartBlock,
  pricing_toggle: PricingToggleBlock,
  faq: FaqBlock,
  comparison: ComparisonBlock,
  funnel: FunnelBlock,
  radar: RadarBlock,
  quadrant_matrix: QuadrantMatrixBlock,
  before_after: BeforeAfterBlock,
  roadmap_gantt: RoadmapGanttBlock,
  logo_testimonial_proof: LogoTestimonialProofBlock,
  case_study_result_cards: CaseStudyResultCardsBlock,
  weighted_decision_matrix: WeightedDecisionMatrixBlock,
}

export const BLOCK_EDITORS: Partial<Record<DocumentBlockType, FC<EditorProps>>> = {
  hero: HeroEditor,
  summary: SummaryEditor,
  problem: ProblemEditor,
  scope: ScopeEditor,
  deliverables: DeliverablesEditor,
  terms: TermsEditor,
  approval: ApprovalEditor,
  rich_text: RichTextEditor,
  timeline: TimelineEditor,
  investment: InvestmentEditor,
  metrics: MetricsEditor,
  risk: RiskEditor,
  table: TableEditor,
  gallery: GalleryEditor,
  callout: CalloutEditor,
  image: ImageEditor,
  video: VideoEditor,
  embed: EmbedEditor,
  link_card: LinkCardEditor,
  chart: ChartEditor,
  pricing_toggle: PricingToggleEditor,
  faq: FaqEditor,
  comparison: ComparisonEditor,
}

export function getRenderer(type: DocumentBlockType): FC<RendererProps> {
  return BLOCK_RENDERERS[type] ?? UnknownBlock
}

export function getEditor(type: DocumentBlockType): FC<EditorProps> {
  return BLOCK_EDITORS[type] ?? UnknownEditor
}

export { BlockFrame } from './BlockFrame'
