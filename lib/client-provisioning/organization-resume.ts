import type { ApiUser } from '@/lib/api/types'
import {
  buildClientProvisioningPayload,
  inferAgentName,
  type ClientProvisioningInput,
} from './provisioner'

export interface ClientOrganizationResumeRecord {
  id: string
  name: string
  slug: string
  type?: string
  createdBy?: string
  workspaceId?: string
  provisioning?: { status?: string; agentName?: string; [key: string]: unknown }
}

export interface ClientOrganizationResumeDependencies {
  getOrganization(organizationId: string): Promise<ClientOrganizationResumeRecord | null>
  provision(input: ClientProvisioningInput): Promise<unknown>
  upsertWorkspace(manifest: ReturnType<typeof buildClientProvisioningPayload>['manifest']): Promise<{ workspaceId: string }>
  patchOrganization(organizationId: string, patch: Record<string, unknown>): Promise<void>
  now(): unknown
}

export interface ClientOrganizationResumeInput {
  organizationId: string
  organizationSlug?: string
  clientName: string
  agentName?: string
  actor: ApiUser
}

export interface ClientOrganizationResumeResponse {
  ok: boolean
  status: number
  data?: Record<string, unknown>
  error?: string
}

export async function resumeClientOrganizationWorkspace(
  input: ClientOrganizationResumeInput,
  dependencies: ClientOrganizationResumeDependencies,
): Promise<ClientOrganizationResumeResponse> {
  const organization = await dependencies.getOrganization(input.organizationId)
  const expectedSlug = input.organizationSlug?.trim()
  if (input.actor.role !== 'admin' || !organization || organization.createdBy !== input.actor.uid
    || organization.id !== input.organizationId || organization.type !== 'client'
    || organization.name !== input.clientName.trim()
    || (expectedSlug && organization.slug !== expectedSlug)) {
    return { ok: false, status: 403, error: 'Client organisation resume is forbidden' }
  }

  if (organization.provisioning?.status === 'complete' && organization.workspaceId) {
    return {
      ok: true,
      status: 200,
      data: { id: organization.id, slug: organization.slug, provisioning: { status: 'complete' } },
    }
  }

  const agentName = input.agentName?.trim()
    || (typeof organization.provisioning?.agentName === 'string' ? organization.provisioning.agentName.trim() : '')
    || inferAgentName(organization.name)
  const provisioningInput: ClientProvisioningInput = {
    clientName: organization.name,
    domain: organization.slug,
    orgId: organization.id,
    agentName,
    companyId: null,
    contactIds: [],
  }
  const provisioningPayload = buildClientProvisioningPayload(provisioningInput)

  try {
    const provisioning = await dependencies.provision(provisioningInput)
    const workspace = await dependencies.upsertWorkspace(provisioningPayload.manifest)
    await dependencies.patchOrganization(organization.id, {
      folderRegistry: provisioningPayload.folderRegistry,
      workspaceId: provisioningPayload.manifest.workspaceId,
      workspaceManifest: provisioningPayload.manifest,
      provisioning: {
        status: 'complete',
        domain: organization.slug,
        agentName,
        workspaceId: workspace.workspaceId,
        updatedAt: dependencies.now(),
        result: provisioning,
      },
      updatedAt: dependencies.now(),
    })
    return {
      ok: true,
      status: 200,
      data: { id: organization.id, slug: organization.slug, provisioning },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Client workspace provisioning failed'
    await dependencies.patchOrganization(organization.id, {
      provisioning: {
        status: 'failed',
        domain: organization.slug,
        agentName,
        error: errorMessage,
        updatedAt: dependencies.now(),
      },
      updatedAt: dependencies.now(),
    })
    return {
      ok: false,
      status: 500,
      error: `Organization workspace provisioning failed: ${errorMessage}`,
      data: { id: organization.id, slug: organization.slug },
    }
  }
}
