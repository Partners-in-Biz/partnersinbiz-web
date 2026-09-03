'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  OrganizationModulePolicyRoleGrid,
  OrganizationModulePolicySaveBar,
  OrganizationOwnerControlsGrid,
  ownerControlRows,
  useOrganizationModulePolicy,
  type OrganizationPolicyActionRow,
} from '@/components/admin-governance/OrganizationModulePolicyControls'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { Icon } from '@/components/studio'

const MESSAGE_PERMISSION_ROWS: OrganizationPolicyActionRow[] = [
  { id: 'visibility', title: 'Messages tab visibility', description: 'Choose which organisation roles can see Messages in the client portal.' },
  { id: 'start', title: 'Start conversations', description: 'Choose who can start client, operator, or agent-assisted conversations.' },
  { id: 'reply', title: 'Reply to conversations', description: 'Choose who can send replies, internal notes, and client-facing responses.' },
  { id: 'agentHandoff', title: 'Use agent handoff', description: 'Choose who can open Theo or operator-agent context from tasks and project work.' },
  { id: 'templates', title: 'Manage templates', description: 'Choose who can create, edit, approve, and delete saved message templates.' },
  { id: 'archive', title: 'Archive conversations', description: 'Choose who can close, archive, reopen, or delete message threads when delegated.' },
]

const MESSAGE_MODULE_ROWS = [
  { label: 'Client messages', description: 'Portal conversations, support context, and client-visible replies.' },
  { label: 'Operator notes', description: 'Internal-only context, handoff notes, and task-linked discussion.' },
  { label: 'Agent conversations', description: 'Task, project, and run-linked AI/operator collaboration.' },
  { label: 'Email and templates', description: 'Reusable responses, campaign replies, and mailbox handoff rules.' },
  { label: 'Conversation analytics', description: 'Response time, queue health, unresolved threads, and channel reporting.' },
]

const THREAD_OWNER_ROWS = [
  'Invite operators',
  'Resolve threads',
  'Use saved replies',
  'Link tasks',
  'Escalate to agents',
  'Manage visibility',
]

interface AdminMessagesGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminMessagesGovernanceWorkspace({ orgSlug }: AdminMessagesGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'messages' })
  const ownerRows = useMemo(() => ownerControlRows(THREAD_OWNER_ROWS), [])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace / Messages"
        title="Messages governance"
        description="Configure who can see, start, reply to, archive, and escalate conversations for this organisation. Direct task and agent links still open the operational chat workspace."
        actions={(
          <Link href={`/admin/org/${encodeURIComponent(orgSlug)}/settings`} className="pib-btn-secondary">
            <Icon name="admin_panel_settings" className="text-[18px]" />
            Org settings
          </Link>
        )}
      />

      <Surface className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow !text-[10px]">Message access</p>
            <h2 className="mt-2 text-lg font-medium text-[var(--color-pib-text)]">Who can use Messages</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
              Every action exposes the same role choices so each organisation can choose its own conversation rules.
            </p>
          </div>
          <span className="shrink-0">
            <Icon name="forum" className="text-[20px] leading-none" />
          </span>
        </div>

        <OrganizationModulePolicyRoleGrid
          rows={MESSAGE_PERMISSION_ROWS}
          policy={policyControls.policy}
          testIdPrefix="message-permission"
          disabled={policyControls.loading || policyControls.saving}
          onRoleChange={policyControls.setRole}
        />
        <OrganizationModulePolicySaveBar
          loading={policyControls.loading}
          saving={policyControls.saving}
          saveState={policyControls.saveState}
          error={policyControls.error}
          onSave={policyControls.save}
        />
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">Conversation modules</p>
        <h2 className="mt-2 text-lg font-medium text-[var(--color-pib-text)]">Default message areas plus organisation controls</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
          Keep the operational chat workspace for live conversation handling, while this page controls which message areas are enabled and who can administer them.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {MESSAGE_MODULE_ROWS.map((module) => (
            <div key={module.label} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
              <h3 className="text-sm font-medium text-[var(--color-pib-text)]">{module.label}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{module.description}</p>
            </div>
          ))}
        </div>
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">Thread-owner settings</p>
        <h2 className="mt-2 text-lg font-medium text-[var(--color-pib-text)]">What conversation owners control inside a thread</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
          These thread-level permissions belong inside the conversation workspace, separate from the admin module rules.
        </p>
        <OrganizationOwnerControlsGrid
          rows={ownerRows}
          policy={policyControls.policy}
          disabled={policyControls.loading || policyControls.saving}
          onControlChange={policyControls.setOwnerControl}
        />
      </Surface>
    </div>
  )
}
