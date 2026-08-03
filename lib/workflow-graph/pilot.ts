import { normalizeGraphTemplate, validateGraphTemplate } from './validation'
import type { GraphTemplate } from './types'

/** Internal pilot template — research → validate → draft → gate → fan-out. */
export function buildPilotResearchValidateDocApproveFanoutTemplate(input?: {
  orgId?: string
  projectId?: string
}): GraphTemplate {
  const orgId = input?.orgId || 'pib-platform-owner'
  const template = normalizeGraphTemplate({
    orgId,
    name: 'pilot-research-validate-doc-approve-fanout',
    version: 1,
    status: 'active',
    pilot: true,
    projectId: input?.projectId,
    limits: {
      maxConcurrentAgentNodes: 2,
      maxConcurrentAgentNodesOrgDefault: 8,
    },
    budgets: {
      currency: 'USD',
      maxTokensPerRun: 500_000,
      maxAgentNodeAttemptsPerRun: 20,
      warnAtRatio: 0.8,
      onExceed: 'pause_run',
    },
    triggers: [{ type: 'manual' }],
    nodes: [
      {
        nodeId: 'research_brief',
        kind: 'agent',
        name: 'Sage: research brief',
        dependsOnNodeIds: [],
        assigneeAgentId: 'sage',
        reviewerAgentId: 'pip',
        requiredCapability: 'research',
        riskLevel: 'medium',
        expectedArtifacts: ['research_doc_id'],
        verifierChecklist: ['research doc id present', 'sections non-empty'],
        agentInput: {
          spec: 'Produce an internal research brief for the Workflow Graph pilot. Return research_doc_id artifact.',
          constraints: ['development only', 'no client-visible output'],
        },
      },
      {
        nodeId: 'check_research',
        kind: 'code_check',
        name: 'Verify research doc',
        dependsOnNodeIds: ['research_brief'],
        checkType: 'artifact_presence',
        expectedArtifacts: ['research_doc_id'],
        checkConfig: { artifactTypes: ['research_doc_id'] },
      },
      {
        nodeId: 'draft_build_note',
        kind: 'agent',
        name: 'Docs: draft internal build note',
        dependsOnNodeIds: ['check_research'],
        assigneeAgentId: 'docs',
        reviewerAgentId: 'pip',
        requiredCapability: 'documents',
        riskLevel: 'low',
        expectedArtifacts: ['draft_doc_id'],
        verifierChecklist: ['draft_doc_id present'],
        agentInput: {
          spec: 'Draft an internal build note from the research brief. Return draft_doc_id.',
          constraints: ['internal only'],
        },
      },
      {
        nodeId: 'check_draft',
        kind: 'code_check',
        name: 'Verify draft artifacts',
        dependsOnNodeIds: ['draft_build_note'],
        checkType: 'artifact_presence',
        expectedArtifacts: ['draft_doc_id'],
      },
      {
        nodeId: 'approve_publish_intent',
        kind: 'human_gate',
        name: 'Human gate: publish-intent sample',
        dependsOnNodeIds: ['check_draft'],
        requiredCapability: 'publish',
        // Explicit Kanban gate — never rely on capability-string passthrough.
        approvalGate: 'public-publishing',
        riskLevel: 'high',
        expectedArtifacts: ['approval_ref'],
        verifierChecklist: ['scoped publish approval present'],
      },
      {
        nodeId: 'noop_publish_system',
        kind: 'system',
        name: 'System: noop publish (gated)',
        dependsOnNodeIds: ['approve_publish_intent'],
        systemAction: 'system:publish_noop',
        requiredCapability: 'publish',
        expectedArtifacts: ['publish_noop_receipt'],
      },
      {
        nodeId: 'eng_checklist',
        kind: 'agent',
        name: 'Theo: stub engineering checklist',
        dependsOnNodeIds: ['noop_publish_system'],
        assigneeAgentId: 'theo',
        reviewerAgentId: 'qa-release',
        requiredCapability: 'engineering',
        riskLevel: 'low',
        expectedArtifacts: ['eng_checklist_id'],
        verifierChecklist: ['eng checklist artifact'],
        agentInput: {
          spec: 'Write a stub engineering checklist artifact eng_checklist_id for the pilot.',
        },
      },
      {
        nodeId: 'content_checklist',
        kind: 'agent',
        name: 'Maya: stub content checklist',
        dependsOnNodeIds: ['noop_publish_system'],
        assigneeAgentId: 'maya',
        reviewerAgentId: 'pip',
        requiredCapability: 'content',
        riskLevel: 'low',
        expectedArtifacts: ['content_checklist_id'],
        verifierChecklist: ['content checklist artifact'],
        agentInput: {
          spec: 'Write a stub content checklist artifact content_checklist_id for the pilot.',
        },
      },
      {
        nodeId: 'check_fanout',
        kind: 'code_check',
        name: 'Verify both checklists',
        dependsOnNodeIds: ['eng_checklist', 'content_checklist'],
        checkType: 'artifact_presence',
        expectedArtifacts: ['eng_checklist_id', 'content_checklist_id'],
      },
    ],
  }, { orgId })

  const validated = validateGraphTemplate(template)
  if (!validated.ok) {
    throw new Error(`Pilot template invalid: ${validated.error}`)
  }
  return validated.template
}

/** Deterministic golden E2E template — stub qa-release agents, lean specs, full Path A shape. */
export function buildGoldenE2EStubPilotTemplate(input?: {
  orgId?: string
  projectId?: string
}): GraphTemplate {
  const orgId = input?.orgId || 'pib-platform-owner'
  const stubSpec = (artifact: string) =>
    `GOLDEN STUB ONLY. Complete immediately. Return agentOutput.artifacts=[{type:"${artifact}",ref:"stub_${artifact}"}] and agentOutput.${artifact}="stub_${artifact}". No research, no client output, no publish.`

  const template = normalizeGraphTemplate({
    orgId,
    name: 'workflow-graph-golden-e2e',
    version: 1,
    status: 'active',
    pilot: true,
    projectId: input?.projectId,
    limits: {
      maxConcurrentAgentNodes: 3,
      maxConcurrentAgentNodesOrgDefault: 8,
    },
    budgets: {
      currency: 'USD',
      maxTokensPerRun: 200_000,
      maxAgentNodeAttemptsPerRun: 20,
      warnAtRatio: 0.8,
      onExceed: 'pause_run',
    },
    notify: {
      quietSuccess: true,
      alertOnBlock: true,
    },
    triggers: [{ type: 'manual' }],
    nodes: [
      {
        nodeId: 'research_brief',
        kind: 'agent',
        name: 'Stub: research brief artifact',
        dependsOnNodeIds: [],
        assigneeAgentId: 'qa-release',
        reviewerAgentId: 'pip',
        requiredCapability: 'research',
        riskLevel: 'low',
        expectedArtifacts: ['research_doc_id'],
        verifierChecklist: ['research_doc_id present'],
        agentInput: {
          spec: stubSpec('research_doc_id'),
          constraints: ['development only', 'stub only', 'no client-visible output'],
        },
      },
      {
        nodeId: 'check_research',
        kind: 'code_check',
        name: 'Verify research doc',
        dependsOnNodeIds: ['research_brief'],
        checkType: 'artifact_presence',
        expectedArtifacts: ['research_doc_id'],
        checkConfig: { artifactTypes: ['research_doc_id'] },
      },
      {
        nodeId: 'draft_build_note',
        kind: 'agent',
        name: 'Stub: draft build note artifact',
        dependsOnNodeIds: ['check_research'],
        assigneeAgentId: 'qa-release',
        reviewerAgentId: 'pip',
        requiredCapability: 'documents',
        riskLevel: 'low',
        expectedArtifacts: ['draft_doc_id'],
        verifierChecklist: ['draft_doc_id present'],
        agentInput: {
          spec: stubSpec('draft_doc_id'),
          constraints: ['internal only', 'stub only'],
        },
      },
      {
        nodeId: 'check_draft',
        kind: 'code_check',
        name: 'Verify draft artifacts',
        dependsOnNodeIds: ['draft_build_note'],
        checkType: 'artifact_presence',
        expectedArtifacts: ['draft_doc_id'],
      },
      {
        nodeId: 'approve_publish_intent',
        kind: 'human_gate',
        name: 'Human gate: publish-intent sample',
        dependsOnNodeIds: ['check_draft'],
        requiredCapability: 'publish',
        approvalGate: 'public-publishing',
        riskLevel: 'high',
        expectedArtifacts: ['approval_ref'],
        verifierChecklist: ['scoped publish approval present'],
      },
      {
        nodeId: 'noop_publish_system',
        kind: 'system',
        name: 'System: noop publish (gated)',
        dependsOnNodeIds: ['approve_publish_intent'],
        systemAction: 'system:publish_noop',
        requiredCapability: 'publish',
        expectedArtifacts: ['publish_noop_receipt'],
      },
      {
        nodeId: 'eng_checklist',
        kind: 'agent',
        name: 'Stub: eng checklist',
        dependsOnNodeIds: ['noop_publish_system'],
        assigneeAgentId: 'qa-release',
        reviewerAgentId: 'pip',
        requiredCapability: 'engineering',
        riskLevel: 'low',
        expectedArtifacts: ['eng_checklist_id'],
        agentInput: { spec: stubSpec('eng_checklist_id') },
      },
      {
        nodeId: 'content_checklist',
        kind: 'agent',
        name: 'Stub: content checklist',
        dependsOnNodeIds: ['noop_publish_system'],
        assigneeAgentId: 'qa-release',
        reviewerAgentId: 'pip',
        requiredCapability: 'content',
        riskLevel: 'low',
        expectedArtifacts: ['content_checklist_id'],
        agentInput: { spec: stubSpec('content_checklist_id') },
      },
      {
        nodeId: 'check_fanout',
        kind: 'code_check',
        name: 'Verify both checklists',
        dependsOnNodeIds: ['eng_checklist', 'content_checklist'],
        checkType: 'artifact_presence',
        expectedArtifacts: ['eng_checklist_id', 'content_checklist_id'],
      },
    ],
  }, { orgId })

  const validated = validateGraphTemplate(template)
  if (!validated.ok) {
    throw new Error(`Golden E2E template invalid: ${validated.error}`)
  }
  return validated.template
}

/** Tiny budget template used only in fail-closed budget tests. */
export function buildTinyBudgetPilotTemplate(orgId = 'pib-platform-owner'): GraphTemplate {
  const template = normalizeGraphTemplate({
    orgId,
    name: 'pilot-tiny-budget',
    version: 1,
    status: 'active',
    pilot: true,
    limits: { maxConcurrentAgentNodes: 1 },
    budgets: {
      currency: 'USD',
      maxTokensPerRun: 100,
      warnAtRatio: 0.5,
      onExceed: 'pause_run',
      maxAgentNodeAttemptsPerRun: 5,
    },
    nodes: [
      {
        nodeId: 'a1',
        kind: 'agent',
        name: 'Agent A',
        dependsOnNodeIds: [],
        assigneeAgentId: 'theo',
        expectedArtifacts: ['a_art'],
        agentInput: { spec: 'Do A' },
      },
      {
        nodeId: 'a2',
        kind: 'agent',
        name: 'Agent B',
        dependsOnNodeIds: ['a1'],
        assigneeAgentId: 'maya',
        expectedArtifacts: ['b_art'],
        agentInput: { spec: 'Do B' },
      },
    ],
  }, { orgId })
  const validated = validateGraphTemplate(template)
  if (!validated.ok) throw new Error(validated.error)
  return validated.template
}
