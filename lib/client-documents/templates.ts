import type {
  ClientDocumentTemplate,
  ClientDocumentType,
  DocumentBlock,
  DocumentBlockType,
} from './types'

const BASE_DISPLAY = { motion: 'reveal' as const }

function block(type: DocumentBlockType, title: string, content: unknown = ''): DocumentBlock {
  return {
    id: type,
    type,
    title,
    content,
    required: true,
    display: { ...BASE_DISPLAY },
  }
}

function requiredBlock(id: string, type: DocumentBlockType, title: string, content: unknown = ''): DocumentBlock {
  return {
    id,
    type,
    title,
    content,
    required: true,
    display: { ...BASE_DISPLAY },
  }
}

function cloneContent(content: unknown): unknown {
  if (content === null || typeof content !== 'object') {
    return content
  }

  return structuredClone(content)
}

export const CLIENT_DOCUMENT_TEMPLATES: ClientDocumentTemplate[] = [
  {
    id: 'sales-proposal-v1',
    type: 'sales_proposal',
    label: 'Sales Proposal',
    picker: {
      description: 'Client-facing commercial proposal for a new engagement, package, or retainer.',
      bestFor: 'Pricing, scope, timeline, terms, and formal acceptance.',
      decides: 'Decides whether the client accepts the proposed work and investment.',
      helpText: 'Use this when the commercial offer is the decision. It can fan out implementation work after acceptance.',
    },
    approvalMode: 'formal_acceptance',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: [
      'hero',
      'problem',
      'scope',
      'deliverables',
      'timeline',
      'investment',
      'terms',
      'approval',
    ],
    contract: {
      purpose: 'sales_proposal',
      recommendedBlockTypes: [
      'hero',
      'problem',
      'scope',
      'deliverables',
      'timeline',
      'investment',
      'terms',
      'approval',
    ],
      approvalMode: 'formal_acceptance',
      taskFanout: 'automatic_after_approval',
      aiPromptKey: 'client_documents.sales_proposal',
    },
    defaultBlocks: [
      block('hero', 'Proposal'),
      block('problem', 'What needs to change'),
      block('scope', 'Scope of work'),
      block('deliverables', 'Deliverables'),
      block('timeline', 'Timeline'),
      block('investment', 'Investment'),
      block('terms', 'Terms'),
      block('approval', 'Acceptance'),
    ],
  },
  {
    id: 'build-spec-v1',
    type: 'build_spec',
    label: 'Website/App Build Spec',
    picker: {
      description: 'Implementation spec for a website, app, integration, or platform feature build.',
      bestFor: 'Requirements, technical approach, data/API changes, tests, rollout, and rollback.',
      decides: 'Specs decide what to build, in what order, and how QA will prove it is done.',
      helpText: 'Choose this after research or discovery is settled and the next decision is build execution.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'deliverables', 'timeline', 'risk', 'approval'],
    contract: {
      purpose: 'implementation_spec',
      recommendedBlockTypes: ['hero', 'summary', 'scope', 'deliverables', 'timeline', 'risk', 'approval'],
      approvalMode: 'operational',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.build_spec',
    },
    defaultBlocks: [
      block('hero', 'Build spec'),
      block('summary', 'Executive summary'),
      block('scope', 'Scope'),
      block('deliverables', 'Deliverables'),
      block('timeline', 'Timeline'),
      block('risk', 'Risks and assumptions'),
      block('approval', 'Sign-off'),
    ],
    agentWorkflowTasks: [
      {
        key: 'implement-build-spec',
        title: 'Theo: implement approved build spec',
        description: 'Implement the approved build spec exactly as signed off. Commit the code, run focused tests, run a production build, and provide the preview deployment URL for QA.',
        sectionId: 'scope',
        assigneeAgentId: 'theo',
        dependsOn: ['$approvalGateTaskId'],
        priority: 'high',
        labels: ['engineering', 'approved-only', 'preview-required'],
        reviewerAgentId: 'qa-release',
        riskLevel: 'high',
        requiredCapability: 'engineering',
        expectedArtifacts: ['commit', 'test-output', 'build-output', 'preview-url'],
      },
      {
        key: 'qa-build-spec',
        title: 'QA: verify approved build spec implementation',
        description: 'Verify the implementation against the approved spec, review evidence, and record QA notes before handoff or release decision.',
        sectionId: 'risk',
        assigneeAgentId: 'qa-release',
        dependsOn: ['implement-build-spec'],
        priority: 'high',
        labels: ['qa', 'approved-spec-verification'],
        reviewerAgentId: 'pip',
        riskLevel: 'high',
        requiredCapability: 'quality-assurance',
        expectedArtifacts: ['test-output', 'build-output', 'qa-notes'],
      },
      {
        key: 'handoff-build-spec',
        title: 'Pip: prepare client handoff and release decision',
        description: 'Summarise implementation and QA evidence, prepare the client/internal handoff, and route any release decision through the required approval gate.',
        sectionId: 'approval',
        assigneeAgentId: 'pip',
        dependsOn: ['qa-build-spec'],
        priority: 'medium',
        labels: ['handoff', 'release-decision'],
        riskLevel: 'medium',
        requiredCapability: 'coordination',
        expectedArtifacts: ['decision-record', 'project-comment-or-task-links'],
      },
    ],
  },
  {
    id: 'social-strategy-v1',
    type: 'social_strategy',
    label: 'Social Strategy',
    picker: {
      description: 'Strategy document for audience, positioning, channels, content pillars, and publishing rhythm.',
      bestFor: 'Social direction, content themes, approval gates, success metrics, and campaign handoff.',
      decides: 'Decides what the brand should say, where it should show up, and how execution will be measured.',
      helpText: 'Use for Maya/social planning. If facts are still uncertain, create a Research Report first.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: [
      'hero',
      'summary',
      'problem',
      'deliverables',
      'timeline',
      'metrics',
      'approval',
    ],
    contract: {
      purpose: 'strategy_plan',
      recommendedBlockTypes: [
      'hero',
      'summary',
      'problem',
      'deliverables',
      'timeline',
      'metrics',
      'approval',
    ],
      approvalMode: 'operational',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.social_strategy',
    },
    defaultBlocks: [
      block('hero', 'Social strategy'),
      block('summary', 'Strategy summary'),
      block('problem', 'Audience and positioning'),
      block('deliverables', 'Channels and content pillars'),
      block('timeline', 'Publishing rhythm'),
      block('metrics', 'Success metrics'),
      block('approval', 'Strategy approval'),
    ],
  },
  {
    id: 'content-campaign-plan-v1',
    type: 'content_campaign_plan',
    label: 'Content Campaign Plan',
    picker: {
      description: 'Campaign execution plan for content assets, calendar, measurement, and approvals.',
      bestFor: 'Asset lists, posting calendars, campaign milestones, and performance targets.',
      decides: 'Decides what content gets produced and when it moves through approval.',
      helpText: 'Use when the campaign strategy is known and the team needs an execution-ready plan.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'deliverables', 'timeline', 'metrics', 'approval'],
    contract: {
      purpose: 'content_plan',
      recommendedBlockTypes: ['hero', 'summary', 'deliverables', 'timeline', 'metrics', 'approval'],
      approvalMode: 'operational',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.content_campaign_plan',
    },
    defaultBlocks: [
      block('hero', 'Content campaign plan'),
      block('summary', 'Campaign overview'),
      block('deliverables', 'Asset plan'),
      block('timeline', 'Calendar'),
      block('metrics', 'Measurement'),
      block('approval', 'Campaign approval'),
    ],
  },
  {
    id: 'geo-seo-strategy-v1',
    type: 'geo_seo_strategy',
    label: 'GEO / SEO Agent Workflow',
    picker: {
      description: 'AI-search and SEO workflow that links Sage research, Maya content, approvals, and measurement.',
      bestFor: 'GEO opportunities, SEO overlap, answer blocks, entity clarity, and agent task routing.',
      decides: 'Decides how research becomes approved GEO/SEO content and measurement work.',
      helpText: 'Use when AI-search visibility work needs linked agent execution rather than a standalone research memo.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'deliverables', 'timeline', 'metrics', 'approval'],
    contract: {
      purpose: 'strategy_plan',
      recommendedBlockTypes: ['hero', 'summary', 'scope', 'deliverables', 'timeline', 'metrics', 'approval'],
      approvalMode: 'operational',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.geo_seo_strategy',
    },
    defaultBlocks: [
      requiredBlock('hero', 'hero', 'GEO SEO workflow', 'Turn AI-search strategy into approved research, content, implementation, and measurement work.'),
      requiredBlock('summary', 'summary', 'Strategy summary', {
        outcome: 'Increase the client\'s likelihood of being understood, cited, and recommended by ChatGPT, Gemini, Perplexity, Claude, Copilot, and Google AI Overviews.',
        operatingModel: 'Sage owns opportunity research, Maya owns content drafting and execution, and Pip keeps client approval gates visible before publish or implementation.',
        sourceOfTruth: 'Tasks must carry orgId plus linked GEO/SEO records and the approved client document/version that released the work.',
      }),
      requiredBlock('scope', 'scope', 'GEO and SEO records to link', {
        geoRecords: ['geoWorkspaceId', 'geoAuditId', 'geoTaskIds[]'],
        seoRecords: ['seoSprintId', 'seoContentId or campaignId where the content overlaps traditional SEO execution'],
        approvalRecords: ['clientDocumentId', 'approvedVersionId', 'approvalId'],
        rule: 'GEO owns AI citability, entity clarity, answerability, crawler policy, llms.txt, and platform-readiness findings. SEO is linked only when the implementation also targets rankings, clicks, impressions, or keyword movement.',
      }),
      requiredBlock('deliverables', 'deliverables', 'Agent workflow deliverables', [
        'Sage opportunity map: AI-search questions, entity gaps, citation risks, platform readiness, evidence, and prioritized opportunities linked to GEO workspace/audit records.',
        'Maya content plan: answer blocks, FAQs, page refreshes, social/email amplification, campaign or SEO content records, and draft copy in the client brand voice.',
        'Client approval gate: approved strategy/spec document before public publishing, site changes, or queued social distribution.',
        'Maya execution pass: publish/schedule approved assets, update campaign/SEO/GEO records, and attach evidence URLs or record IDs to the project task.',
        'Measurement loop: monthly GEO delta report, linked learnings, and next opportunities back into the GEO workspace.',
      ]),
      requiredBlock('timeline', 'timeline', 'Workflow sequence', [
        '1. Sage researches GEO opportunities from the approved brief and active GEO audit/workspace.',
        '2. Maya drafts the content/action plan from Sage research and links drafts to SEO/GEO records.',
        '3. Pip or the operator routes the client approval gate and keeps dependent tasks blocked until approval lands.',
        '4. Maya executes approved content, schedules distribution, and records evidence against the campaign/SEO/GEO ledger.',
        '5. Sage or Pip reviews performance deltas and creates the next cycle of linked opportunities.',
      ]),
      requiredBlock('metrics', 'metrics', 'Success metrics', {
        geo: ['GEO score delta', 'platform-readiness score', 'AI-citable answer block coverage', 'entity clarity/trust signal completion', 'brand mention/citation evidence'],
        seoOverlap: ['linked SEO sprint task completion', 'content status', 'indexability or ranking metrics only when the GEO task also overlaps traditional SEO'],
        approval: ['approvalId attached', 'approvedVersionId attached', 'client changes resolved before execution'],
      }),
      requiredBlock('approval', 'approval', 'Client approval to execute', 'Approval confirms PiB can generate agent tasks from this workflow, start Sage research, let Maya draft/execute approved content, and link all outputs to the relevant GEO, SEO, campaign, and client-document records.'),
    ],
    agentWorkflowTasks: [
      {
        key: 'sage-geo-opportunity-research',
        title: 'Sage: research GEO SEO opportunities',
        description: 'Research AI-search visibility opportunities, citation gaps, entity clarity, platform readiness, and answerable questions. Link findings to the GEO workspace/audit and flag any SEO-overlap opportunities.',
        sectionId: 'deliverables',
        assigneeAgentId: 'sage',
        priority: 'high',
        labels: ['geo-seo', 'sage', 'research', 'geo-record-required', 'seo-overlap-check'],
      },
      {
        key: 'maya-content-draft',
        title: 'Maya: draft GEO-informed content plan and assets',
        description: 'Use Sage research to draft answer blocks, FAQs, page updates, social/email amplification, and campaign or SEO content drafts in the client brand voice. Link each draft to the relevant GEO opportunity and SEO/content record where applicable.',
        sectionId: 'deliverables',
        assigneeAgentId: 'maya',
        dependsOn: ['sage-geo-opportunity-research'],
        priority: 'high',
        labels: ['geo-seo', 'maya', 'content-draft', 'client-approval-required', 'seo-content-link'],
      },
      {
        key: 'client-approval-gate',
        title: 'Pip: secure client approval for GEO content execution',
        description: 'Route the GEO content plan and drafts for client approval. Capture approvalId, approvedVersionId, and any requested changes before execution begins.',
        sectionId: 'approval',
        assigneeAgentId: 'pip',
        dependsOn: ['maya-content-draft'],
        priority: 'high',
        labels: ['geo-seo', 'approval-gate', 'client-documents', 'approval-record-required'],
      },
      {
        key: 'maya-execute-approved-content',
        title: 'Maya: execute approved GEO content and distribution',
        description: 'Publish, schedule, or hand off approved GEO content only after approval is recorded. Update campaign/social/SEO/GEO records and attach evidence links or record IDs back to this task.',
        sectionId: 'timeline',
        assigneeAgentId: 'maya',
        dependsOn: ['client-approval-gate'],
        priority: 'high',
        labels: ['geo-seo', 'maya', 'execution', 'approved-only', 'linked-artifacts-required'],
      },
      {
        key: 'sage-geo-delta-review',
        title: 'Sage: review GEO delta and next opportunities',
        description: 'After execution evidence is attached, review GEO score/platform deltas, update the GEO workspace, and create the next opportunity set or monthly report inputs.',
        sectionId: 'metrics',
        assigneeAgentId: 'sage',
        dependsOn: ['maya-execute-approved-content'],
        priority: 'medium',
        labels: ['geo-seo', 'sage', 'measurement', 'geo-report'],
      },
    ],
  },
  {
    id: 'research-report-v1',
    type: 'research_report',
    label: 'Research Report',
    picker: {
      description: 'Evidence-led report for findings, confidence, contradictions, unknowns, and recommendations.',
      bestFor: 'Research questions, source ledgers, truth checks, options, and decision support.',
      decides: 'Research decides what is true, what is still unknown, and what options are credible.',
      helpText: 'Use this before a spec when Peet or the client needs evidence. It should not blindly create code tasks.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: [
      'summary',
      'problem',
      'rich_text',
      'table',
      'deliverables',
      'metrics',
      'risk',
      'callout',
      'approval',
    ],
    contract: {
      purpose: 'research_presentation',
      recommendedBlockTypes: [
        'summary',
        'problem',
        'rich_text',
        'table',
        'deliverables',
        'metrics',
        'risk',
        'callout',
        'approval',
      ],
      approvalMode: 'operational',
      taskFanout: 'none',
      aiPromptKey: 'client_documents.research_report',
    },
    defaultBlocks: [
      requiredBlock('research_question', 'summary', 'Research question'),
      requiredBlock('context_hypothesis', 'problem', 'Context / hypothesis'),
      requiredBlock('methodology', 'rich_text', 'Methodology'),
      requiredBlock('source_ledger', 'table', 'Source ledger'),
      requiredBlock('findings', 'deliverables', 'Findings'),
      requiredBlock('confidence', 'metrics', 'Confidence'),
      requiredBlock('contradictions_unknowns', 'risk', 'Contradictions / unknowns'),
      requiredBlock('recommendations', 'callout', 'Recommendations'),
      requiredBlock('evidence_appendix', 'table', 'Evidence appendix'),
      requiredBlock('decision_needed', 'approval', 'Decision needed'),
    ],
    agentWorkflowTasks: [
      {
        key: 'research-decision',
        title: 'Pip: record decision from approved research report',
        description: 'Record the decision or routing outcome from the approved research report and link the resulting project comment, task, or decision record.',
        sectionId: 'decision_needed',
        assigneeAgentId: 'pip',
        dependsOn: ['$approvalGateTaskId'],
        priority: 'medium',
        labels: ['research-report', 'decision-routing'],
        riskLevel: 'medium',
        requiredCapability: 'decision-routing',
        expectedArtifacts: ['decision-record', 'project-comment-or-task-links'],
      },
      {
        key: 'research-recommendations',
        title: 'Sage: convert approved research recommendations into next-step options',
        description: 'Turn the approved research recommendations into evidence-backed next-step options, preserving links to source research items and open assumptions.',
        sectionId: 'recommendations',
        assigneeAgentId: 'sage',
        dependsOn: ['research-decision'],
        priority: 'medium',
        labels: ['research-report', 'recommendations'],
        reviewerAgentId: 'pip',
        riskLevel: 'medium',
        requiredCapability: 'research-recommendation-followup',
        expectedArtifacts: ['recommendation-options', 'project-comment-or-task-links'],
      },
    ],
  },
  {
    id: 'monthly-report-v1',
    type: 'monthly_report',
    label: 'Monthly Report',
    picker: {
      description: 'Performance recap for a completed month across activity, outcomes, learnings, and next actions.',
      bestFor: 'KPIs, highlights, blockers, client-visible progress, and next-month priorities.',
      decides: 'Decides what progress is reported and what follow-up actions need attention.',
      helpText: 'Use for review/reporting. It summarises work already done; it is not a build spec.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'metrics', 'callout', 'approval'],
    contract: {
      purpose: 'performance_report',
      recommendedBlockTypes: ['hero', 'summary', 'metrics', 'callout', 'approval'],
      approvalMode: 'operational',
      taskFanout: 'none',
      aiPromptKey: 'client_documents.monthly_report',
    },
    defaultBlocks: [
      block('hero', 'Monthly report'),
      block('summary', 'Executive summary'),
      block('metrics', 'Performance'),
      block('callout', 'Next actions'),
      block('approval', 'Acknowledgement'),
    ],
  },
  {
    id: 'launch-signoff-v1',
    type: 'launch_signoff',
    label: 'Launch Sign-off',
    picker: {
      description: 'Go/no-go sign-off for launch readiness, known limitations, and acceptance.',
      bestFor: 'Launch checklists, readiness notes, known risks, and final approval before release.',
      decides: 'Decides whether an approved build is ready to launch or needs more work.',
      helpText: 'Use after implementation and QA evidence exists. Do not use it to define new scope.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'risk', 'approval'],
    contract: {
      purpose: 'launch_acceptance',
      recommendedBlockTypes: ['hero', 'summary', 'scope', 'risk', 'approval'],
      approvalMode: 'operational',
      taskFanout: 'manual',
      aiPromptKey: 'client_documents.launch_signoff',
    },
    defaultBlocks: [
      block('hero', 'Launch sign-off'),
      block('summary', 'What is ready'),
      block('scope', 'Launch checklist'),
      block('risk', 'Known limitations'),
      block('approval', 'Launch approval'),
    ],
  },
  {
    id: 'change-request-v1',
    type: 'change_request',
    label: 'Change Request',
    picker: {
      description: 'Scoped change to approved work, including impact on scope, timeline, and cost.',
      bestFor: 'New requests, scope changes, budget impact, timeline impact, and approval-gated implementation.',
      decides: 'Decides whether an approved plan changes and what implementation tasks become valid.',
      helpText: 'Use when the client asks for something outside the current approved spec or proposal.',
    },
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: true,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'timeline', 'investment', 'approval'],
    contract: {
      purpose: 'scope_change_approval',
      recommendedBlockTypes: ['hero', 'summary', 'scope', 'timeline', 'investment', 'approval'],
      approvalMode: 'operational',
      taskFanout: 'approval_gated',
      aiPromptKey: 'client_documents.change_request',
    },
    defaultBlocks: [
      block('hero', 'Change request'),
      block('summary', 'Requested change'),
      block('scope', 'Scope impact'),
      block('timeline', 'Timeline impact'),
      block('investment', 'Cost impact'),
      block('approval', 'Change approval'),
    ],
    agentWorkflowTasks: [
      {
        key: 'implement-change-request',
        title: 'Theo: implement approved change request',
        description: 'Implement the approved change request, preserving the agreed scope and timeline impacts. Commit the change and provide test/build evidence.',
        sectionId: 'scope',
        assigneeAgentId: 'theo',
        dependsOn: ['$approvalGateTaskId'],
        priority: 'high',
        labels: ['engineering', 'change-request', 'approved-only'],
        reviewerAgentId: 'qa-release',
        riskLevel: 'high',
        requiredCapability: 'engineering',
        expectedArtifacts: ['commit', 'test-output', 'build-output', 'preview-url'],
      },
      {
        key: 'qa-change-request',
        title: 'QA: verify approved change request',
        description: 'Verify the change request implementation against the approved scope and record QA evidence.',
        sectionId: 'timeline',
        assigneeAgentId: 'qa-release',
        dependsOn: ['implement-change-request'],
        priority: 'high',
        labels: ['qa', 'change-request-verification'],
        reviewerAgentId: 'pip',
        riskLevel: 'high',
        requiredCapability: 'quality-assurance',
        expectedArtifacts: ['test-output', 'build-output', 'qa-notes'],
      },
      {
        key: 'handoff-change-request',
        title: 'Pip: update scope/timeline handoff after change request',
        description: 'Update the scope and timeline handoff after QA, then route any client-facing release or timeline decision through the right approval path.',
        sectionId: 'approval',
        assigneeAgentId: 'pip',
        dependsOn: ['qa-change-request'],
        priority: 'medium',
        labels: ['handoff', 'change-request'],
        riskLevel: 'medium',
        requiredCapability: 'coordination',
        expectedArtifacts: ['decision-record', 'project-comment-or-task-links'],
      },
    ],
  },
]

const LEGACY_SAFE_FALLBACK_TEMPLATE: ClientDocumentTemplate = {
  id: 'legacy-safe-fallback',
  type: 'build_spec',
  label: 'Legacy Document',
  picker: {
    description: 'Safe fallback for older or unknown document templates.',
    bestFor: 'Viewing legacy documents without breaking rendering or share links.',
    decides: 'Decides nothing automatically; route manually if more work is needed.',
    helpText: 'This fallback preserves old documents. Create a new typed document for new work.',
  },
  approvalMode: 'operational',
  clientPermissions: {
    canComment: true,
    canSuggest: true,
    canDirectEdit: false,
    canApprove: true,
  },
  requiredBlockTypes: ['hero', 'summary', 'approval'],
  contract: {
    purpose: 'legacy_safe_fallback',
    recommendedBlockTypes: ['hero', 'summary', 'approval'],
    approvalMode: 'operational',
    taskFanout: 'manual',
    aiPromptKey: 'client_documents.legacy_safe_fallback',
  },
  defaultBlocks: [
    block('hero', 'Legacy document'),
    block('summary', 'Summary'),
    block('approval', 'Acknowledgement'),
  ],
}

const LEGACY_TEMPLATE_ID_ALIASES: Record<string, ClientDocumentType> = {
  sales_proposal: 'sales_proposal',
  build_spec: 'build_spec',
  research_report: 'research_report',
  change_request: 'change_request',
}

type TemplateLookup = ClientDocumentType | { type?: unknown; templateId?: unknown }

function isClientDocumentType(value: unknown): value is ClientDocumentType {
  return typeof value === 'string' && CLIENT_DOCUMENT_TEMPLATES.some(template => template.type === value)
}

function findTemplateByLookup(lookup: TemplateLookup): ClientDocumentTemplate | undefined {
  if (typeof lookup === 'string') {
    return CLIENT_DOCUMENT_TEMPLATES.find(candidate => candidate.type === lookup)
  }

  if (isClientDocumentType(lookup.type)) {
    return CLIENT_DOCUMENT_TEMPLATES.find(candidate => candidate.type === lookup.type)
  }

  if (typeof lookup.templateId === 'string') {
    const exact = CLIENT_DOCUMENT_TEMPLATES.find(candidate => candidate.id === lookup.templateId)
    if (exact) return exact

    const aliasType = LEGACY_TEMPLATE_ID_ALIASES[lookup.templateId]
    if (aliasType) {
      return CLIENT_DOCUMENT_TEMPLATES.find(candidate => candidate.type === aliasType)
    }
  }

  return undefined
}

export function getClientDocumentTemplate(type: ClientDocumentType): ClientDocumentTemplate
export function getClientDocumentTemplate(lookup: { type?: unknown; templateId?: unknown }): ClientDocumentTemplate
export function getClientDocumentTemplate(lookup: TemplateLookup): ClientDocumentTemplate {
  const template = findTemplateByLookup(lookup)

  if (!template) {
    if (typeof lookup === 'string') {
      throw new Error(`Unknown client document template type: ${lookup}`)
    }

    return LEGACY_SAFE_FALLBACK_TEMPLATE
  }

  return template
}

export function createBlocksFromTemplate(type: ClientDocumentType): DocumentBlock[] {
  return getClientDocumentTemplate(type).defaultBlocks.map(templateBlock => ({
    ...templateBlock,
    content: cloneContent(templateBlock.content),
    display: { ...templateBlock.display },
  }))
}
