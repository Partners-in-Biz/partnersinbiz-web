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
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'deliverables', 'timeline', 'risk', 'approval'],
    defaultBlocks: [
      block('hero', 'Build spec'),
      block('summary', 'Executive summary'),
      block('scope', 'Scope'),
      block('deliverables', 'Deliverables'),
      block('timeline', 'Timeline'),
      block('risk', 'Risks and assumptions'),
      block('approval', 'Sign-off'),
    ],
  },
  {
    id: 'social-strategy-v1',
    type: 'social_strategy',
    label: 'Social Media Strategy',
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
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'deliverables', 'timeline', 'metrics', 'approval'],
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
    label: 'GEO SEO Agent Workflow',
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'deliverables', 'timeline', 'metrics', 'approval'],
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
    id: 'monthly-report-v1',
    type: 'monthly_report',
    label: 'Monthly Report',
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'metrics', 'callout', 'approval'],
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
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'risk', 'approval'],
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
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: true,
      canApprove: true,
    },
    requiredBlockTypes: ['hero', 'summary', 'scope', 'timeline', 'investment', 'approval'],
    defaultBlocks: [
      block('hero', 'Change request'),
      block('summary', 'Requested change'),
      block('scope', 'Scope impact'),
      block('timeline', 'Timeline impact'),
      block('investment', 'Cost impact'),
      block('approval', 'Change approval'),
    ],
  },
]

export function getClientDocumentTemplate(type: ClientDocumentType): ClientDocumentTemplate {
  const template = CLIENT_DOCUMENT_TEMPLATES.find(candidate => candidate.type === type)

  if (!template) {
    throw new Error(`Unknown client document template type: ${type}`)
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
