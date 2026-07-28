/**
 * GET /api/v1/orgs/[orgId]/visible-agents
 *
 * Auth: admin or client (any org member)
 * Returns: enabled agents from agent_team, filtered to the caller's visible set,
 *          with apiKey stripped entirely.
 *
 * Visibility layers (all must pass for custom linked agents):
 *   1. Role / chat-config defaults (admin → full roster, client → pip)
 *   2. Explicit Team `agentRuntimeAccess` grants on the selected computer
 *   3. Org-scoped custom agents the caller owns or manages
 *   4. Linked-device readiness (available + credential-ready on that machine)
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { orgChatConfigDoc, resolveVisibleAgents } from '@/lib/conversations/conversations'
import { memberCanUseAgentOnRuntime } from '@/lib/orgMembers/access-policy'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'
import type { AgentId } from '@/lib/agents/types'
import type { AgentTeamStoredDoc } from '@/lib/agents/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

type ScopedAgentRow = AgentTeamStoredDoc & {
  scopeOrgId?: string
  ownerUserId?: string
  createdByUserId?: string
  homeDeviceId?: string
  accessScope?: 'personal' | 'organization'
  provisioningMode?: string
  provisioningStatus?: string
}

export const GET = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    // Determine caller role — ai acts as admin
    const callerRole: 'admin' | 'client' =
      user.role === 'admin' || user.role === 'ai' ? 'admin' : 'client'

    // Read org chat config (may be null — defaults applied in resolveVisibleAgents)
    const configDoc = await orgChatConfigDoc(scope.orgId).get()
    const config = configDoc.exists
      ? (configDoc.data() as { visibleAgents?: { admin?: AgentId[]; client?: AgentId[] } })
      : null

    const allowedAgentIds = new Set<AgentId>(resolveVisibleAgents(config, callerRole))
    const runtimeTargetId = req.nextUrl.searchParams.get('runtimeTarget')?.trim() || null

    // Auth hydrates memberAccessPolicy for the profile activeOrgId only.
    // Grants must be evaluated against the org being viewed.
    const memberDoc = await adminDb.collection('orgMembers').doc(`${scope.orgId}_${user.uid}`).get()
    const memberRole = memberDoc.data()?.role
    const orgManager = user.role === 'admin' || memberRole === 'owner' || memberRole === 'admin'
    const scopedAccessPolicy = (await loadOrgMemberAccessPolicy(scope.orgId, user.uid))
      ?? user.memberAccessPolicy
      ?? null

    const selectedDeviceId = runtimeTargetId?.startsWith('linked-device:')
      ? runtimeTargetId.slice('linked-device:'.length)
      : runtimeTargetId
    const selectedDeviceDoc = selectedDeviceId
      ? await adminDb.collection('linked_devices').doc(selectedDeviceId).get()
      : null
    const selectedDevice = selectedDeviceDoc?.exists ? selectedDeviceDoc.data() ?? null : null
    const selectedAvailableAgentIds = Array.isArray(selectedDevice?.availableAgentIds)
      ? selectedDevice.availableAgentIds as unknown[]
      : []
    const selectedCredentialReadyAgentIds = Array.isArray(selectedDevice?.credentialReadyAgentIds)
      ? selectedDevice.credentialReadyAgentIds as unknown[]
      : []

    const snap = await adminDb.collection('agent_team').get()
    for (const doc of snap.docs) {
      const row = doc.data() as ScopedAgentRow
      const isOrgScoped = Boolean(row.scopeOrgId)
      if (isOrgScoped && row.scopeOrgId !== scope.orgId) continue

      if (row.provisioningMode === 'linked_device'
        && (!selectedAvailableAgentIds.includes(row.agentId)
          || !selectedCredentialReadyAgentIds.includes(row.agentId))) {
        continue
      }

      const ownerRuntimeMatches = selectedDevice?.ownerUserId === user.uid
        && selectedAvailableAgentIds.includes(row.agentId)
      const grantedOnRuntime = Boolean(
        runtimeTargetId
        && scopedAccessPolicy
        && memberCanUseAgentOnRuntime(scopedAccessPolicy, runtimeTargetId, row.agentId),
      )

      if (isOrgScoped) {
        // Tenant-scoped custom agents: managers see shared ones; owners see
        // personal agents on their machine; members need an explicit grant.
        if (
          (orgManager && row.accessScope !== 'personal')
          || (row.ownerUserId === user.uid && ownerRuntimeMatches)
          || grantedOnRuntime
        ) {
          allowedAgentIds.add(row.agentId)
        }
      } else if (grantedOnRuntime) {
        // Platform specialists (theo, maya, …) are role-gated by default.
        // Team access can delegate them per computer without expanding the
        // whole client role list.
        allowedAgentIds.add(row.agentId)
      }
    }

    const result = snap.docs
      .map((d) => d.data() as AgentTeamStoredDoc)
      .filter((agent) => {
        if (!agent.enabled || !allowedAgentIds.has(agent.agentId)) return false
        const provisioning = agent as ScopedAgentRow
        if (provisioning.provisioningMode === 'linked_device' && provisioning.provisioningStatus !== 'ready') {
          return false
        }
        const scopedOrgId = (agent as ScopedAgentRow).scopeOrgId
        return !scopedOrgId || scopedOrgId === scope.orgId
      })
      .map((agent) => {
        // Strip apiKey entirely — never expose, even masked
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { apiKey: _apiKey, ...safe } = agent
        return safe
      })

    return apiSuccess(result)
  },
)
