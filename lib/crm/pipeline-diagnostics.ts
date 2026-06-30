import type { Contact, Deal } from '@/lib/crm/types'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

type ContactLike = Partial<Contact> & { id?: string }
type DealLike = Partial<Deal> & { id?: string }
type PipelineLike = Partial<Pipeline> & { id?: string; stages?: Partial<PipelineStage>[] }

export type CrmPipelineFindingCode =
  | 'pipeline_setup_incomplete'
  | 'contacts_without_deals'
  | 'no_open_deals'
  | 'open_deals_without_value'
  | 'deal_pipeline_mapping_gap'
  | 'pipeline_ready'

export interface CrmPipelineDiagnosticsInput {
  contacts: ContactLike[]
  deals: DealLike[]
  pipelines: PipelineLike[]
}

export interface CrmPipelineDiagnostics {
  generatedAt: string
  summary: {
    totalContacts: number
    leadContacts: number
    prospectContacts: number
    leadLikeContacts: number
    totalDeals: number
    openDeals: number
    wonDeals: number
    lostDeals: number
    openPipelineValue: number
    weightedOpenPipelineValue: number
    pipelineCount: number
    defaultPipelineCount: number
    openStageCount: number
  }
  contactFunnel: {
    byType: Record<string, number>
    byStage: Record<string, number>
    bySource: Record<string, number>
  }
  dealFunnel: {
    byPipelineStage: Array<{
      pipelineId: string
      pipelineName: string
      stageId: string
      stageLabel: string
      stageKind: string
      dealCount: number
      totalValue: number
      weightedValue: number
    }>
  }
  dataQuality: {
    contactsWithoutCompany: number
    contactsWithoutOwner: number
    openDealsMissingValue: number
    openDealsMissingPipeline: number
    openDealsMissingStage: number
    openDealsMissingContact: number
    openDealsMissingCompany: number
    openDealsMissingExpectedCloseDate: number
  }
  primaryFinding: {
    code: CrmPipelineFindingCode
    title: string
    detail: string
  }
  nextActions: string[]
}

function increment(map: Record<string, number>, key: unknown) {
  const clean = typeof key === 'string' && key.trim() ? key.trim() : 'unknown'
  map[clean] = (map[clean] ?? 0) + 1
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stageKey(pipelineId: string | undefined, stageId: string | undefined) {
  return `${pipelineId || 'missing-pipeline'}:${stageId || 'missing-stage'}`
}

function contactIsLeadLike(contact: ContactLike): boolean {
  if (contact.deleted === true) return false
  if (contact.type === 'lead' || contact.type === 'prospect') return true
  return ['new', 'contacted', 'replied', 'demo', 'proposal'].includes(String(contact.stage ?? ''))
}

function pipelineIsActive(pipeline: PipelineLike): boolean {
  return pipeline.deleted !== true && pipeline.archived !== true
}

function buildStageLookup(pipelines: PipelineLike[]) {
  const stages = new Map<string, Partial<PipelineStage> & { pipelineName: string }>()
  for (const pipeline of pipelines.filter(pipelineIsActive)) {
    const pipelineId = pipeline.id ?? ''
    if (!pipelineId) continue
    for (const stage of pipeline.stages ?? []) {
      if (!stage.id) continue
      stages.set(stageKey(pipelineId, stage.id), {
        ...stage,
        pipelineName: pipeline.name ?? pipelineId,
      })
    }
  }
  return stages
}

function classifyDeal(deal: DealLike, stage?: Partial<PipelineStage>) {
  if (deal.deleted === true) return 'deleted'
  if (deal.lostReason || stage?.kind === 'lost') return 'lost'
  if ((deal.probability ?? stage?.probability ?? 50) >= 100 || stage?.kind === 'won') return 'won'
  return 'open'
}

function findingFor(args: {
  activePipelines: PipelineLike[]
  summary: CrmPipelineDiagnostics['summary']
  dataQuality: CrmPipelineDiagnostics['dataQuality']
}): CrmPipelineDiagnostics['primaryFinding'] {
  const { activePipelines, summary, dataQuality } = args
  if (activePipelines.length === 0 || summary.defaultPipelineCount === 0 || summary.openStageCount === 0) {
    return {
      code: 'pipeline_setup_incomplete',
      title: 'CRM pipeline setup is incomplete',
      detail: 'The workspace needs an active default pipeline with at least one open stage before agents can create and forecast deals consistently.',
    }
  }
  if (summary.leadLikeContacts > 0 && summary.totalDeals === 0) {
    return {
      code: 'contacts_without_deals',
      title: 'Lead volume is not converting into deal records',
      detail: 'CRM contacts exist, but there are no deal records for the workspace. Pipeline value is zero because the lead-to-deal conversion workflow is missing or not being used.',
    }
  }
  if (summary.leadLikeContacts > 0 && summary.openDeals === 0) {
    return {
      code: 'no_open_deals',
      title: 'There are CRM leads, but no open deals',
      detail: 'Deals may all be closed, lost, deleted, or never opened from the current lead base. Agents need to inspect recent lead activity and create qualified opportunities.',
    }
  }
  if (summary.openDeals > 0 && summary.openPipelineValue === 0) {
    return {
      code: 'open_deals_without_value',
      title: 'Open deals exist, but pipeline value is zero',
      detail: 'The open pipeline is present but commercially unpriced. Add expected deal values so forecast and daily pipeline decisions are meaningful.',
    }
  }
  if (dataQuality.openDealsMissingPipeline > 0 || dataQuality.openDealsMissingStage > 0) {
    return {
      code: 'deal_pipeline_mapping_gap',
      title: 'Some open deals are missing pipeline mapping',
      detail: 'Open deals without pipeline or stage references cannot be trusted in stage, velocity, or forecast analysis.',
    }
  }
  return {
    code: 'pipeline_ready',
    title: 'CRM pipeline has usable deal data',
    detail: 'The workspace has lead data and open pipeline value. Agents can use the returned funnel, quality, and stage summaries for focused follow-up decisions.',
  }
}

function nextActionsFor(finding: CrmPipelineDiagnostics['primaryFinding']): string[] {
  switch (finding.code) {
    case 'pipeline_setup_incomplete':
      return [
        'Create or select one default sales pipeline with clear open, won, and lost stages.',
        'Only after the default route exists, let agents create qualified deals from lead contacts.',
      ]
    case 'contacts_without_deals':
      return [
        'Create or repair the lead-to-deal conversion workflow so qualified lead/prospect contacts become deal records.',
        'Run a lead qualification pass: highest-score or recently active leads first, then create deals with owner, value, stage, and expected close date.',
        'Ask Blake to return a short follow-up queue, not a permanent dashboard.',
      ]
    case 'no_open_deals':
      return [
        'Review recent leads and closed/lost deals to decide which contacts need new opportunities reopened.',
        'Confirm whether zero open pipeline is intentional or caused by missing stage mapping.',
      ]
    case 'open_deals_without_value':
      return [
        'Add realistic expected values to open deals before using pipeline value in CEO decisions.',
        'Prioritize deals with proposal/demo stages and missing values for immediate cleanup.',
      ]
    case 'deal_pipeline_mapping_gap':
      return [
        'Backfill or repair pipelineId and stageId on open deals before trusting stage-level reports.',
        'Use the existing CRM pipeline migration tools in dry-run mode before applying any writes.',
      ]
    case 'pipeline_ready':
      return [
        'Use this diagnostics payload for the daily CRM follow-up queue: high-value open deals, stale stages, missing owners, and close-date gaps.',
        'Create a temporary HTML answer only when Peet asks a specific pipeline question that needs visual comparison.',
      ]
  }
}

export function buildCrmPipelineDiagnostics(input: CrmPipelineDiagnosticsInput): CrmPipelineDiagnostics {
  const contacts = input.contacts.filter((contact) => contact.deleted !== true)
  const deals = input.deals.filter((deal) => deal.deleted !== true)
  const activePipelines = input.pipelines.filter(pipelineIsActive)
  const stages = buildStageLookup(activePipelines)

  const contactFunnel = {
    byType: {} as Record<string, number>,
    byStage: {} as Record<string, number>,
    bySource: {} as Record<string, number>,
  }
  let leadContacts = 0
  let prospectContacts = 0
  let leadLikeContacts = 0
  let contactsWithoutCompany = 0
  let contactsWithoutOwner = 0

  for (const contact of contacts) {
    increment(contactFunnel.byType, contact.type)
    increment(contactFunnel.byStage, contact.stage)
    increment(contactFunnel.bySource, contact.source)
    if (contact.type === 'lead') leadContacts += 1
    if (contact.type === 'prospect') prospectContacts += 1
    if (contactIsLeadLike(contact)) leadLikeContacts += 1
    if (!contact.companyId && !contact.companyName && !contact.company) contactsWithoutCompany += 1
    if (!contact.assignedTo && !contact.assignedToRef) contactsWithoutOwner += 1
  }

  const stageAccumulators = new Map<string, {
    pipelineId: string
    pipelineName: string
    stageId: string
    stageLabel: string
    stageKind: string
    dealCount: number
    totalValue: number
    weightedValue: number
  }>()

  let openDeals = 0
  let wonDeals = 0
  let lostDeals = 0
  let openPipelineValue = 0
  let weightedOpenPipelineValue = 0
  let openDealsMissingValue = 0
  let openDealsMissingPipeline = 0
  let openDealsMissingStage = 0
  let openDealsMissingContact = 0
  let openDealsMissingCompany = 0
  let openDealsMissingExpectedCloseDate = 0

  for (const deal of deals) {
    const stage = stages.get(stageKey(deal.pipelineId, deal.stageId))
    const status = classifyDeal(deal, stage)
    if (status === 'won') wonDeals += 1
    if (status === 'lost') lostDeals += 1
    if (status !== 'open') continue

    openDeals += 1
    const value = numeric(deal.value)
    const probability = deal.probability ?? stage?.probability ?? 50
    const weightedValue = value * (numeric(probability) / 100)
    openPipelineValue += value
    weightedOpenPipelineValue += weightedValue

    if (value <= 0) openDealsMissingValue += 1
    if (!deal.pipelineId) openDealsMissingPipeline += 1
    if (!deal.stageId) openDealsMissingStage += 1
    if (!deal.contactId) openDealsMissingContact += 1
    if (!deal.companyId && !deal.companyName) openDealsMissingCompany += 1
    if (!deal.expectedCloseDate) openDealsMissingExpectedCloseDate += 1

    const key = stageKey(deal.pipelineId, deal.stageId)
    const acc = stageAccumulators.get(key) ?? {
      pipelineId: deal.pipelineId ?? 'missing-pipeline',
      pipelineName: stage?.pipelineName ?? deal.pipelineId ?? 'Missing pipeline',
      stageId: deal.stageId ?? 'missing-stage',
      stageLabel: stage?.label ?? deal.stageId ?? 'Missing stage',
      stageKind: stage?.kind ?? 'unknown',
      dealCount: 0,
      totalValue: 0,
      weightedValue: 0,
    }
    acc.dealCount += 1
    acc.totalValue += value
    acc.weightedValue += weightedValue
    stageAccumulators.set(key, acc)
  }

  const summary = {
    totalContacts: contacts.length,
    leadContacts,
    prospectContacts,
    leadLikeContacts,
    totalDeals: deals.length,
    openDeals,
    wonDeals,
    lostDeals,
    openPipelineValue,
    weightedOpenPipelineValue,
    pipelineCount: activePipelines.length,
    defaultPipelineCount: activePipelines.filter((pipeline) => pipeline.isDefault === true).length,
    openStageCount: activePipelines.reduce((count, pipeline) => (
      count + (pipeline.stages ?? []).filter((stage) => stage.kind === 'open').length
    ), 0),
  }

  const dataQuality = {
    contactsWithoutCompany,
    contactsWithoutOwner,
    openDealsMissingValue,
    openDealsMissingPipeline,
    openDealsMissingStage,
    openDealsMissingContact,
    openDealsMissingCompany,
    openDealsMissingExpectedCloseDate,
  }
  const primaryFinding = findingFor({ activePipelines, summary, dataQuality })

  return {
    generatedAt: new Date().toISOString(),
    summary,
    contactFunnel,
    dealFunnel: {
      byPipelineStage: [...stageAccumulators.values()].sort((a, b) => b.totalValue - a.totalValue),
    },
    dataQuality,
    primaryFinding,
    nextActions: nextActionsFor(primaryFinding),
  }
}
