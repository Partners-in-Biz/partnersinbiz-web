import {
  normalizeRuntimeTargets,
  publicRuntimeTargetPresence,
  runtimeTargetTransportIdentity,
  type PublicRuntimeTargetPresence,
} from '@/lib/agents/runtime-targets'
import type { AgentId } from '@/lib/agents/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  authorizeLinkedComputerDispatch,
  type AuthorizedLinkedComputerDispatch,
} from '@/lib/linked-computers/runtime-targets'
import { authorizeExecutionLocationDispatch } from '@/lib/project-locations/discovery'

export interface WorkspaceRuntimeAuthorizationInput {
  userId: string
  orgId: string
  workspaceId: string
  runtimeTargetId: string
  agentId?: AgentId
}

type CompatibilityRuntimeTarget = PublicRuntimeTargetPresence & { transportIdentity?: string }

export type AuthorizedWorkspaceRuntime =
  | {
      kind: 'execution-location'
      locationId: string
      runtimeTargetId: string
      machineLabel: string
      locationKind: 'vps' | 'computer'
      organizationAccessible: boolean
      transportIdentity: string
    }
  | AuthorizedLinkedComputerDispatch

interface AuthorizationOptions {
  loadCompatibilityTargets?: (agentId: AgentId) => Promise<CompatibilityRuntimeTarget[]>
  authorizeExecution?: typeof authorizeExecutionLocationDispatch
  authorizeLinked?: typeof authorizeLinkedComputerDispatch
}

async function loadCompatibilityTargets(agentId: AgentId): Promise<CompatibilityRuntimeTarget[]> {
  const snapshot = await adminDb.collection('agent_dispatch_configs').doc(agentId).get()
  const rawTargets = snapshot.data()?.runtimeTargets
  const normalizedById = new Map(normalizeRuntimeTargets(rawTargets).map((target) => [target.id, target]))
  return publicRuntimeTargetPresence(rawTargets).map((target) => {
    const normalized = normalizedById.get(target.id)
    return normalized
      ? { ...target, transportIdentity: runtimeTargetTransportIdentity(normalized) }
      : target
  })
}

export async function authorizeWorkspaceRuntime(
  input: WorkspaceRuntimeAuthorizationInput,
  options: AuthorizationOptions = {},
): Promise<AuthorizedWorkspaceRuntime> {
  const agentId = input.agentId ?? 'pip'
  const compatibilityTargets = await (options.loadCompatibilityTargets ?? loadCompatibilityTargets)(agentId)
  const compatibilityTarget = compatibilityTargets.find((target) => target.id === input.runtimeTargetId)
  if (compatibilityTarget) {
    const authorized = await (options.authorizeExecution ?? authorizeExecutionLocationDispatch)({
      ...input,
      compatibilityTargets,
    })
    return {
      kind: 'execution-location',
      locationId: authorized.locationId,
      runtimeTargetId: authorized.runtimeTargetId,
      machineLabel: authorized.machineLabel,
      locationKind: authorized.kind,
      organizationAccessible: authorized.organizationAccessible,
      transportIdentity: compatibilityTarget.transportIdentity ?? '',
    }
  }
  return (options.authorizeLinked ?? authorizeLinkedComputerDispatch)(input)
}

export function workspaceRuntimeSupportsOrganizationSharing(runtime: AuthorizedWorkspaceRuntime): boolean {
  return runtime.kind === 'execution-location'
    ? runtime.organizationAccessible
    : runtime.accessMode === 'organization'
}
