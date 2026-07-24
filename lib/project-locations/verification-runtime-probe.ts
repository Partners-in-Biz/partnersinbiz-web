import type { ProjectExecutionLocation, ProjectLocationReplica } from './model'
import type { PartnersLocationVerificationEvidence } from './verification'
import type {
  LocalWorkspaceProjectProbeInput,
  WorkspaceFolderObservation,
  WorkspaceProjectProbeInput,
} from './verification-probes'

export const PARTNERS_VPS_WORKSPACE_ROOT = '/var/lib/hermes/Cowork/partners/Partners in Biz'
export const PARTNERS_LOCAL_WORKSPACE_ROOT = '/Users/peetstander/Cowork/partners/Partners in Biz'

export interface PartnersLocationEvidenceProbeDependencies {
  runtimeHealth(runtimeTargetId: string): Promise<{ statusCode: number; latencyMs?: number }>
  remoteFolders(input: WorkspaceProjectProbeInput): Promise<WorkspaceFolderObservation>
  localFolders(input: LocalWorkspaceProjectProbeInput): Promise<WorkspaceFolderObservation>
  now(): Date
}

export function createPartnersLocationEvidenceProbe(
  dependencies: PartnersLocationEvidenceProbeDependencies,
): (
  location: ProjectExecutionLocation,
  replicas: ProjectLocationReplica[],
) => Promise<PartnersLocationVerificationEvidence> {
  return async (location, replicas) => {
    let runtimeHealth: { statusCode: number; latencyMs?: number }
    try {
      runtimeHealth = await dependencies.runtimeHealth(location.runtimeTargetId)
    } catch {
      throw new Error(`${location.locationId} runtime health probe failed`)
    }
    const projects = replicas.map((replica) => ({
      projectId: replica.projectId,
      relativePath: replica.relativePath,
    }))
    let folders: WorkspaceFolderObservation
    let folderProbe: 'ssh-filesystem' | 'local-filesystem'
    try {
      if (location.locationId === 'partners-vps') {
        folders = await dependencies.remoteFolders({ workspaceRoot: PARTNERS_VPS_WORKSPACE_ROOT, projects })
        folderProbe = 'ssh-filesystem'
      } else if (location.locationId === 'peets-mac-mini') {
        folders = await dependencies.localFolders({
          workspaceRoot: PARTNERS_LOCAL_WORKSPACE_ROOT,
          expectedWorkspaceRoot: PARTNERS_LOCAL_WORKSPACE_ROOT,
          projects,
        })
        folderProbe = 'local-filesystem'
      } else {
        throw new Error('unsupported location')
      }
    } catch {
      throw new Error(`${location.locationId} workspace folder probe failed`)
    }
    return {
      locationId: location.locationId,
      checkedAt: dependencies.now().toISOString(),
      runtimeHealth: {
        statusCode: runtimeHealth.statusCode,
        probe: 'authenticated-runtime-health',
        ...(runtimeHealth.latencyMs === undefined ? {} : { latencyMs: runtimeHealth.latencyMs }),
      },
      folders: { probe: folderProbe, ...folders },
    }
  }
}
