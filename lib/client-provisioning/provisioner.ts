export type ClientProvisioningInput = {
  clientName: string
  domain: string
  orgId: string
  agentName?: string
}

export type ClientFolderVisibility = 'admin_only' | 'admin_agents' | 'admin_agents_clients'
export type ClientFolderSourceOfTruth = 'vps' | 'local' | 'google_drive' | 'obsidian'
export type ClientFolderSyncMode = 'full' | 'metadata_only' | 'manual'
export type ClientFolderSyncState = 'pending' | 'synced' | 'error'
export type ClientFolderConflictStatus = 'none' | 'needs_review' | 'resolved'

export type ClientFolderRegistryRecord = {
  id: string
  orgId: string
  workspaceId: string
  resourceType: 'client_workspace' | 'google_drive' | 'obsidian'
  resourceId: string
  label: string
  description: string
  parentId: string | null
  visibility: ClientFolderVisibility
  tags: string[]
  sortOrder: number
  sourceOfTruth: ClientFolderSourceOfTruth
  driveFolderId: string | null
  driveFolderUrl: string | null
  syncTargets: {
    vpsPath: string | null
    localPath: string | null
  }
  syncMode: ClientFolderSyncMode
  syncState: ClientFolderSyncState
  conflictStatus: ClientFolderConflictStatus
  audit: {
    createdBy: 'client_provisioning'
    updatedBy: 'client_provisioning'
    lastCheckedAt: null
    notes: string[]
  }
}

export type ClientProvisioningPayload = {
  clientName: string
  domain: string
  orgId: string
  agentName: string
  workspacePath: string
  agentDomainPath: string
  folderRegistry: ClientFolderRegistryRecord[]
  soul: string
}

const VPS_COWORK_ROOT = '/var/lib/hermes/Cowork'
const VPS_OBSIDIAN_ROOT = `${VPS_COWORK_ROOT}/Cowork`
const LOCAL_COWORK_ROOT = '~/Cowork'
const LOCAL_OBSIDIAN_ROOT = `${LOCAL_COWORK_ROOT}/Cowork`

export function inferAgentName(clientName: string): string {
  return clientName.trim().split(/\s+/)[0] || 'Client'
}

export function buildClientProvisioningPayload(input: ClientProvisioningInput): ClientProvisioningPayload {
  const clientName = input.clientName.trim()
  const domain = input.domain.trim()
  const orgId = input.orgId.trim()
  const agentName = (input.agentName?.trim() || inferAgentName(clientName)).trim()
  const workspacePath = `${VPS_COWORK_ROOT}/${clientName}`
  const agentDomainPath = `${VPS_OBSIDIAN_ROOT}/agents/${domain}`
  const folderRegistry = buildDefaultFolderRegistry({ clientName, domain, orgId, workspacePath, agentDomainPath })

  return {
    clientName,
    domain,
    orgId,
    agentName,
    workspacePath,
    agentDomainPath,
    folderRegistry,
    soul: renderSoul({ clientName, domain, orgId, agentName, workspacePath, agentDomainPath }),
  }
}

function folderRecord({
  id,
  orgId,
  domain,
  resourceType,
  label,
  description,
  parentId = null,
  visibility,
  tags,
  sortOrder,
  sourceOfTruth,
  vpsPath,
  localPath,
}: {
  id: string
  orgId: string
  domain: string
  resourceType: ClientFolderRegistryRecord['resourceType']
  label: string
  description: string
  parentId?: string | null
  visibility: ClientFolderVisibility
  tags: string[]
  sortOrder: number
  sourceOfTruth: ClientFolderSourceOfTruth
  vpsPath: string | null
  localPath: string | null
}): ClientFolderRegistryRecord {
  return {
    id,
    orgId,
    workspaceId: domain,
    resourceType,
    resourceId: `${domain}:${id}`,
    label,
    description,
    parentId,
    visibility,
    tags,
    sortOrder,
    sourceOfTruth,
    driveFolderId: null,
    driveFolderUrl: null,
    syncTargets: { vpsPath, localPath },
    syncMode: 'full',
    syncState: 'pending',
    conflictStatus: 'none',
    audit: {
      createdBy: 'client_provisioning',
      updatedBy: 'client_provisioning',
      lastCheckedAt: null,
      notes: [],
    },
  }
}

export function buildDefaultFolderRegistry({
  clientName,
  domain,
  orgId,
  workspacePath,
  agentDomainPath,
}: {
  clientName: string
  domain: string
  orgId: string
  workspacePath: string
  agentDomainPath: string
}): ClientFolderRegistryRecord[] {
  const localWorkspacePath = `${LOCAL_COWORK_ROOT}/${clientName}`
  const localAgentDomainPath = `${LOCAL_OBSIDIAN_ROOT}/agents/${domain}`

  return [
    folderRecord({
      id: 'workspace-root',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: clientName,
      description: 'Client VPS/local workspace root. Markdown belongs in Obsidian; binaries belong in Google Drive.',
      visibility: 'admin_agents',
      tags: ['workspace', 'vps', 'local-sync'],
      sortOrder: 10,
      sourceOfTruth: 'vps',
      vpsPath: workspacePath,
      localPath: localWorkspacePath,
    }),
    folderRecord({
      id: 'admin-ops',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: 'Admin operations',
      description: 'Internal-only operational notes, account setup details, and private admin material.',
      parentId: 'workspace-root',
      visibility: 'admin_only',
      tags: ['admin', 'operations'],
      sortOrder: 20,
      sourceOfTruth: 'vps',
      vpsPath: `${workspacePath}/operations/admin`,
      localPath: `${localWorkspacePath}/operations/admin`,
    }),
    folderRecord({
      id: 'agent-briefs',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: 'Agent briefs',
      description: 'Agent-facing task briefs, working plans, and execution notes.',
      parentId: 'workspace-root',
      visibility: 'admin_agents',
      tags: ['briefs', 'agents'],
      sortOrder: 30,
      sourceOfTruth: 'vps',
      vpsPath: `${workspacePath}/briefs`,
      localPath: `${localWorkspacePath}/briefs`,
    }),
    folderRecord({
      id: 'client-deliverables',
      orgId,
      domain,
      resourceType: 'client_workspace',
      label: 'Client deliverables',
      description: 'Final outputs that can be shown to clients after review.',
      parentId: 'workspace-root',
      visibility: 'admin_agents_clients',
      tags: ['deliverables', 'client-visible'],
      sortOrder: 40,
      sourceOfTruth: 'vps',
      vpsPath: `${workspacePath}/deliverables`,
      localPath: `${localWorkspacePath}/deliverables`,
    }),
    folderRecord({
      id: 'drive-assets',
      orgId,
      domain,
      resourceType: 'google_drive',
      label: 'Drive assets',
      description: 'Google Drive folder link for binary/source assets. Admins may link any suitable Drive location.',
      parentId: 'workspace-root',
      visibility: 'admin_agents_clients',
      tags: ['drive', 'binary-assets', 'source-assets', 'client-visible'],
      sortOrder: 50,
      sourceOfTruth: 'google_drive',
      vpsPath: `${workspacePath}/assets`,
      localPath: `${localWorkspacePath}/assets`,
    }),
    folderRecord({
      id: 'drive-private-assets',
      orgId,
      domain,
      resourceType: 'google_drive',
      label: 'Private Drive assets',
      description: 'Google Drive folder link for admin/agent-only binary/source assets that must not be shared with clients.',
      parentId: 'workspace-root',
      visibility: 'admin_agents',
      tags: ['drive', 'binary-assets', 'source-assets', 'private'],
      sortOrder: 60,
      sourceOfTruth: 'google_drive',
      vpsPath: `${workspacePath}/assets/private`,
      localPath: `${localWorkspacePath}/assets/private`,
    }),
    folderRecord({
      id: 'obsidian-root',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian domain',
      description: 'Client markdown knowledge domain in Obsidian.',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown'],
      sortOrder: 70,
      sourceOfTruth: 'obsidian',
      vpsPath: agentDomainPath,
      localPath: localAgentDomainPath,
    }),
    folderRecord({
      id: 'obsidian-wiki',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian wiki',
      description: 'Durable markdown knowledge articles and hot cache.',
      parentId: 'obsidian-root',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown', 'wiki'],
      sortOrder: 80,
      sourceOfTruth: 'obsidian',
      vpsPath: `${agentDomainPath}/wiki`,
      localPath: `${localAgentDomainPath}/wiki`,
    }),
    folderRecord({
      id: 'obsidian-raw',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian raw sources',
      description: 'Markdown/source text captures for research and evidence; binary originals stay in Drive.',
      parentId: 'obsidian-root',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown', 'raw-sources'],
      sortOrder: 90,
      sourceOfTruth: 'obsidian',
      vpsPath: `${agentDomainPath}/raw`,
      localPath: `${localAgentDomainPath}/raw`,
    }),
    folderRecord({
      id: 'obsidian-logs',
      orgId,
      domain,
      resourceType: 'obsidian',
      label: 'Obsidian logs',
      description: 'Markdown session logs and continuity notes.',
      parentId: 'obsidian-root',
      visibility: 'admin_agents',
      tags: ['obsidian', 'markdown', 'logs'],
      sortOrder: 100,
      sourceOfTruth: 'obsidian',
      vpsPath: `${agentDomainPath}/logs`,
      localPath: `${localAgentDomainPath}/logs`,
    }),
  ]
}

export function renderSoul({
  clientName,
  domain,
  orgId,
  agentName,
  workspacePath,
  agentDomainPath,
}: {
  clientName: string
  domain: string
  orgId: string
  agentName: string
  workspacePath: string
  agentDomainPath: string
}) {
  return `# ${clientName} / ${agentName} — Hermes Agent Profile

You are ${agentName}, the dedicated Hermes agent for the ${clientName} project in Peet Stander's Cowork workspace. Never say you are Codex, Claude, Hermes Agent, or any other generic AI model — you are ${agentName}.

Focus: strategy, research, planning, writing, content, operations, documentation, execution support, and structured follow-through for ${clientName} workstreams.

## Canonical Links

- Profile: \`${domain}\`
- PiB org_id: \`${orgId}\`
- Project folder: \`${workspacePath}\`
- Obsidian vault: \`${VPS_OBSIDIAN_ROOT}\`
- Obsidian agent domain: \`${agentDomainPath}\`
- Agent index: \`${agentDomainPath}/index.md\`
- Hot cache: \`${agentDomainPath}/wiki/hot.md\`
- Wiki articles: \`${agentDomainPath}/wiki\`
- Raw sources: \`${agentDomainPath}/raw\`
- Session logs: \`${agentDomainPath}/logs\`

## Startup Routine

1. Read the global Cowork instructions: \`${VPS_OBSIDIAN_ROOT}/global-context.md\`.
2. Read the project instructions: \`${workspacePath}/CLAUDE.md\`.
3. Read the hot cache and index if they exist.
4. Check recent logs when continuity matters.

## Knowledge Rules

- Durable project knowledge goes in \`${agentDomainPath}/wiki/<topic>.md\`.
- Raw/clipped sources go in \`${agentDomainPath}/raw/\`.
- Session summaries go in \`${agentDomainPath}/logs/YYYY-MM-DD.md\`.
- Cross-project knowledge goes in \`${VPS_OBSIDIAN_ROOT}/shared/wiki/\`.
- Keep \`${agentDomainPath}/index.md\` updated.

## Workspace Organisation

Everything created for this project must live under \`${workspacePath}\`.

- docs/ — documentation, strategy notes, specs, and durable references
- briefs/ — task briefs, campaign briefs, requirements, stakeholder instructions
- assets/ — images, brand files, media, design source files
- marketing/ — content plans, copy, social/email/web campaigns, publishing calendars
- research/ — market/person/background research and source synthesis
- operations/ — admin, SOPs, checklists, process docs, setup notes
- deliverables/ — final outputs to send, publish, or hand over
- inbox/ — unsorted incoming material to triage
- archive/ — stale/superseded material retained for reference

## Behaviour

- Be direct and action-oriented.
- Do not guess project context when CLAUDE.md, SOUL.md, or Obsidian files can be read.
- Persist useful knowledge to the ${clientName} Obsidian domain.
`
}
