import { normalizeGraphTemplate, validateGraphTemplate } from './validation'
import type { GraphNodeTemplate, GraphTemplate, WorkflowNodeKind } from './types'
import type { ProjectPlaybookTemplateV1 } from '@/lib/projects/playbooks'

function mapTaskKind(taskKind: 'agent' | 'approval-gate' | 'human'): WorkflowNodeKind {
  if (taskKind === 'agent') return 'agent'
  return 'human_gate'
}

/**
 * Promote a structured project playbook template into a GraphTemplate.
 * Single-write path for new graph-backed runs — do not also write playbookRuns
 * for the same execution.
 */
export function promotePlaybookTemplateToGraphTemplate(input: {
  orgId: string
  name: string
  playbookId: string
  playbookTemplate: ProjectPlaybookTemplateV1
  projectId?: string
  status?: GraphTemplate['status']
}): { ok: true; template: GraphTemplate } | { ok: false; error: string } {
  const nodes: GraphNodeTemplate[] = input.playbookTemplate.steps.map((step) => {
    const kind = mapTaskKind(step.taskKind)
    const dependsOnNodeIds = Array.from(new Set([
      ...step.dependsOnStepIds,
      ...(step.approvalGateStepId ? [step.approvalGateStepId] : []),
    ]))

    return {
      nodeId: step.stepId,
      kind,
      name: step.title,
      dependsOnNodeIds,
      assigneeAgentId: kind === 'agent' ? step.assigneeAgentId : undefined,
      agentInput: kind === 'agent' ? step.agentInput : undefined,
      expectedArtifacts: step.expectedArtifacts,
      verifierChecklist: step.verifierChecklist,
      reviewerAgentId: step.reviewerAgentId,
      // Keep requiredCapability as a real capability only — never copy playbook
      // approvalGate (human-review / paid-spend / finance / …) into it.
      requiredCapability: step.requiredCapability || undefined,
      // Carry Kanban gate on the graph node so materialize can set task.approvalGate
      // the same way classic playbook materialize does.
      approvalGate:
        kind === 'human_gate' && step.approvalGate && step.approvalGate !== 'none'
          ? step.approvalGate
          : undefined,
      riskLevel: (step.riskLevel as GraphNodeTemplate['riskLevel']) || undefined,
    }
  })

  const template = normalizeGraphTemplate({
    orgId: input.orgId,
    name: input.name,
    status: input.status || 'active',
    projectId: input.projectId,
    sourcePlaybookId: input.playbookId,
    executionBackend: 'workflow_graph',
    nodes,
    triggers: [{ type: 'manual' }],
  })

  const validated = validateGraphTemplate(template)
  if (!validated.ok) return { ok: false, error: validated.error }
  return { ok: true, template: validated.template }
}
