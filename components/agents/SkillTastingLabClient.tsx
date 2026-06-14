'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import UnifiedChat from '@/components/chat/UnifiedChat'

interface AgentTeamDoc {
  agentId: string
  name: string
  role: string
  enabled: boolean
  skillPolicy?: {
    pibSkills?: string[]
    runtimeSkills?: string[]
    globalSkills?: string[]
    deniedSkills?: string[]
    capabilities?: string[]
    approvalGates?: string[]
  } | null
}

interface SkillPolicyView {
  policy?: {
    pibSkills?: string[]
    runtimeSkills?: string[]
    globalSkills?: string[]
    deniedSkills?: string[]
    capabilities?: string[]
    approvalGates?: string[]
  }
}

interface SessionInfo {
  uid?: string
  displayName?: string
  email?: string
  orgId?: string
}

interface OrganizationSummary {
  id: string
  name: string
  slug?: string
  type?: string
  status?: string
}

interface LabRun {
  conversationId: string
  agentId: string
  skill: string
  prompt: string
  createdAt: string
  runId?: string
}

const PLATFORM_ORG_ID = 'pib-platform-owner'

const SCENARIO_TEMPLATES = [
  {
    label: 'Social/content dry run',
    prompt: 'Create one draft social post for an internal PiB service announcement. Do not schedule or publish anything. Include a short note explaining which parts came from the selected skill.',
  },
  {
    label: 'Research summary',
    prompt: 'Produce a concise evidence-led research brief for a hypothetical internal platform decision. Use no live client data unless I provide it. Include assumptions and confidence.',
  },
  {
    label: 'Project handoff',
    prompt: 'Turn this idea into a safe Projects/Kanban handoff outline. Do not create live tasks unless explicitly told to. Include blockers, owner, evidence, and approval gate if needed.',
  },
  {
    label: 'Skill self-review',
    prompt: 'Use the selected skill on this test prompt, then critique whether the skill instructions were sufficient. List any missing steps or stale assumptions without editing the skill yet.',
  },
]

const REVIEW_OPTIONS = [
  { value: 'pass', label: 'Pass' },
  { value: 'needs-tweak', label: 'Needs tweak' },
  { value: 'broken', label: 'Broken' },
]

const LEARNING_REVIEW_SCHEDULES = [
  { value: '0 7 * * 1', label: 'Weekly Monday 07:00 UTC' },
  { value: '0 7 1 * *', label: 'Monthly on the 1st 07:00 UTC' },
  { value: '0 7 1 */3 *', label: 'Quarterly on the 1st 07:00 UTC' },
]

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))).sort()
}

function displayName(session: SessionInfo | null): string {
  return session?.displayName || session?.email || session?.uid || 'Admin'
}

function buildLearningReviewPrompt(scope: 'system' | 'client', org: OrganizationSummary | undefined, focus: string) {
  const orgLine = scope === 'system'
    ? 'Scope: system-wide Partners in Biz parent workspace (orgId: pib-platform-owner). Do not inspect or mutate client-scoped records except as aggregate routing evidence.'
    : `Scope: client organisation ${org?.name ?? 'Unknown client'} (orgId: ${org?.id ?? 'unknown'}, slug: ${org?.slug ?? 'unknown'}). Keep findings tenant-isolated to this organisation.`

  return [
    '[Agent Learning Review — scheduled PiB self-improvement run]',
    orgLine,
    '',
    'Purpose:',
    'Run the PiB version of the Hermes Dreaming pattern: scan → stage → review → validate → approve → apply or discard. This job creates reviewable proposals only. It must not silently mutate skills, memories, wiki facts, client documents, schedules, social posts, email, ads, billing, secrets, production, or live client-visible state.',
    '',
    'Sources to consider, only where safely accessible for this scope:',
    '- Cowork wiki hot.md, topical wiki notes, and recent session logs for this scope.',
    '- Projects/Kanban tasks, comments, blockers, completed outputs, and approval gates.',
    '- Research items, skill tasting evidence, repeated failures, stale runbooks, and agent handoff notes.',
    '- For client scope only: client campaigns/social/SEO/research/project outcomes for the selected orgId, with tenant isolation.',
    '',
    'Required output:',
    '1. If nothing actionable is found, stay concise and say the run is clean.',
    '2. For useful findings, create or update reviewable internal proposals/tasks through Projects/Kanban or Research; dedupe against existing open tasks first.',
    '3. Each proposal must include source paths or record IDs, what was noticed, proposed change, target record/file, owner/reviewer, risk level, approval gate needed, validation evidence, rollback/backup plan, and confidence.',
    '4. Route by ownership: Pip for orchestration/governance, Theo for code/platform, Maya for content/social/voice, Sage for research/SEO/intelligence, Nora for CRM/admin/billing/email ops, Quinn/qa-release for QA/release evidence.',
    '5. Sensitive actions remain hard-gated: no production deploy, paid spend, public publishing, client-visible sends, invoice/payment changes, destructive data operations, or secret/config changes without explicit approval.',
    '6. Close material findings in the Cowork wiki daily log/topical note/read-first layer when they create durable knowledge.',
    '',
    focus.trim() ? `Operator focus for this run: ${focus.trim()}` : 'Operator focus for this run: general self-improvement and blocker-pattern review.',
  ].join('\n')
}

function buildSandboxPrompt(agent: AgentTeamDoc | undefined, skill: string, userPrompt: string) {
  return [
    '[Skill Tasting Lab — internal sandbox run]',
    `Selected agent: ${agent?.name ?? 'Unknown'} (${agent?.agentId ?? 'unknown'})`,
    `Selected skill: ${skill}`,
    '',
    'Hard constraints for this tasting run:',
    '- Use only the selected skill as the specialist frame for this answer. If another skill would be required, say so instead of using it silently.',
    '- Internal-only sandbox. Do not publish, schedule posts, send emails/messages, launch paid spend, change billing/invoices, delete data, edit secrets/config, deploy production, or perform client-visible actions.',
    '- If client context is required and no specific client workspace is provided, ask for the client or use clearly labelled synthetic assumptions only.',
    '- Keep the output reviewable: state what you produced, what evidence or assumptions you used, and whether the selected skill was sufficient.',
    '- If the skill seems stale, incomplete, or unsafe, include a short “Skill improvement notes” section.',
    '',
    'Tester prompt:',
    userPrompt.trim(),
  ].join('\n')
}

export default function SkillTastingLabClient() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [agents, setAgents] = useState<AgentTeamDoc[]>([])
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [policy, setPolicy] = useState<SkillPolicyView | null>(null)
  const [selectedSkill, setSelectedSkill] = useState('')
  const [prompt, setPrompt] = useState(SCENARIO_TEMPLATES[0].prompt)
  const [loading, setLoading] = useState(true)
  const [policyLoading, setPolicyLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [taskCreating, setTaskCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [labRun, setLabRun] = useState<LabRun | null>(null)
  const [reviewStatus, setReviewStatus] = useState('needs-tweak')
  const [reviewNotes, setReviewNotes] = useState('')
  const [learningScope, setLearningScope] = useState<'system' | 'client'>('system')
  const [learningOrgId, setLearningOrgId] = useState('')
  const [learningSchedule, setLearningSchedule] = useState(LEARNING_REVIEW_SCHEDULES[0].value)
  const [learningFocus, setLearningFocus] = useState('')
  const [learningCreating, setLearningCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [sessionRes, agentsRes, orgsRes] = await Promise.all([
          fetch('/api/auth/verify', { cache: 'no-store' }),
          fetch('/api/v1/admin/agents', { cache: 'no-store' }),
          fetch('/api/v1/organizations', { cache: 'no-store' }),
        ])
        const sessionBody = await sessionRes.json().catch(() => null)
        const agentsBody = await agentsRes.json().catch(() => null)
        const orgsBody = await orgsRes.json().catch(() => null)
        if (!agentsRes.ok) throw new Error(agentsBody?.error || `Failed to load agents (${agentsRes.status})`)
        if (!orgsRes.ok) throw new Error(orgsBody?.error || `Failed to load organisations (${orgsRes.status})`)
        if (cancelled) return
        const liveAgents = ((agentsBody?.data ?? []) as AgentTeamDoc[]).filter((agent) => agent.enabled)
        setSession(sessionBody ?? null)
        const orgs = ((orgsBody?.data ?? []) as OrganizationSummary[]).filter((org) => org.id && org.id !== PLATFORM_ORG_ID)
        setAgents(liveAgents)
        setOrganizations(orgs)
        setSelectedAgentId((current) => current || liveAgents[0]?.agentId || '')
        setLearningOrgId((current) => current || orgs[0]?.id || '')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Skill Tasting Lab')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedAgentId) return
    let cancelled = false
    async function loadPolicy() {
      setPolicyLoading(true)
      setPolicy(null)
      setSelectedSkill('')
      try {
        const res = await fetch(`/api/v1/admin/agents/${encodeURIComponent(selectedAgentId)}/skill-policy`, { cache: 'no-store' })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error || `Failed to load skill policy (${res.status})`)
        if (cancelled) return
        setPolicy(body?.data ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load skill policy')
      } finally {
        if (!cancelled) setPolicyLoading(false)
      }
    }
    loadPolicy()
    return () => { cancelled = true }
  }, [selectedAgentId])

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.agentId === selectedAgentId),
    [agents, selectedAgentId],
  )

  const skillOptions = useMemo(() => {
    const source = policy?.policy ?? selectedAgent?.skillPolicy ?? {}
    return unique([
      ...(source.runtimeSkills ?? []),
      ...(source.pibSkills ?? []),
      ...(source.globalSkills ?? []),
    ])
  }, [policy, selectedAgent])

  useEffect(() => {
    if (skillOptions.length > 0 && !selectedSkill) setSelectedSkill(skillOptions[0])
  }, [selectedSkill, skillOptions])

  const sandboxPrompt = useMemo(
    () => selectedSkill ? buildSandboxPrompt(selectedAgent, selectedSkill, prompt) : '',
    [prompt, selectedAgent, selectedSkill],
  )

  async function startRun(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!selectedAgentId || !selectedSkill || !prompt.trim()) {
      setError('Select an agent, select a skill, and write a tasting prompt first.')
      return
    }
    setStarting(true)
    try {
      const title = `Skill Lab: ${selectedAgent?.name ?? selectedAgentId} / ${selectedSkill.split('/').pop()}`
      const convRes = await fetch('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: PLATFORM_ORG_ID,
          title,
          scope: 'general',
          participants: [{ kind: 'agent', agentId: selectedAgentId }],
        }),
      })
      const convBody = await convRes.json().catch(() => null)
      if (!convRes.ok) throw new Error(convBody?.error || `Conversation create failed (${convRes.status})`)
      const conversationId = convBody?.data?.conversation?.id
      if (!conversationId) throw new Error('Conversation create did not return an id')

      const msgRes = await fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: sandboxPrompt }),
      })
      const msgBody = await msgRes.json().catch(() => null)
      if (!msgRes.ok) throw new Error(msgBody?.error || `Tasting message failed (${msgRes.status})`)

      setLabRun({
        conversationId,
        agentId: selectedAgentId,
        skill: selectedSkill,
        prompt: sandboxPrompt,
        createdAt: new Date().toISOString(),
        runId: msgBody?.data?.runId,
      })
      setMessage('Sandbox run started. The transcript is live below.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start tasting run')
    } finally {
      setStarting(false)
    }
  }


  async function createLearningReviewJob() {
    setError(null)
    setMessage(null)
    const selectedOrg = organizations.find((org) => org.id === learningOrgId)
    if (learningScope === 'client' && !selectedOrg) {
      setError('Select the client organisation this learning review should run against.')
      return
    }
    if (!learningSchedule.trim()) {
      setError('Set a schedule before creating the learning review job.')
      return
    }
    setLearningCreating(true)
    try {
      const scopeLabel = learningScope === 'system' ? 'System' : selectedOrg?.name ?? learningOrgId
      const res = await fetch('/api/v1/admin/agents/pip/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Agent Learning Review — ${scopeLabel}`,
          schedule: learningSchedule.trim(),
          prompt: buildLearningReviewPrompt(learningScope, selectedOrg, learningFocus),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `Learning review schedule failed (${res.status})`)
      const jobId = body?.data?.job_id ?? body?.data?.id ?? body?.job_id ?? body?.id ?? ''
      setMessage(`Scheduled ${scopeLabel} learning review${jobId ? ` (${jobId})` : ''}. It will run under Pip and create reviewable proposals only.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule learning review')
    } finally {
      setLearningCreating(false)
    }
  }

  async function createImprovementTask() {
    if (!labRun) return
    setTaskCreating(true)
    setError(null)
    setMessage(null)
    try {
      const body = {
        orgId: PLATFORM_ORG_ID,
        title: `Skill improvement: ${labRun.agentId} / ${labRun.skill}`,
        description: [
          'Skill Tasting Lab review requested a follow-up.',
          '',
          `Agent: ${labRun.agentId}`,
          `Skill: ${labRun.skill}`,
          `Review status: ${reviewStatus}`,
          `Conversation: /admin/skill-lab?conversationId=${labRun.conversationId}`,
          labRun.runId ? `Run id: ${labRun.runId}` : '',
          '',
          'Reviewer notes:',
          reviewNotes.trim() || '(No notes supplied.)',
          '',
          'Sandbox prompt:',
          labRun.prompt,
        ].filter(Boolean).join('\n'),
        priority: reviewStatus === 'broken' ? 'high' : 'normal',
        status: 'todo',
        assignedTo: { type: 'agent', id: 'pip' },
        tags: ['skill-lab', `agent:${labRun.agentId}`, `skill:${labRun.skill}`],
        assigneeAgentId: 'pip',
        agentInput: {
          spec: `Review Skill Tasting Lab evidence for ${labRun.agentId} / ${labRun.skill} and route the required skill improvement to the correct owner. Do not change production, publish, spend, send client-visible messages, or edit secrets without approval.`,
          context: {
            source: 'skill-tasting-lab',
            conversationId: labRun.conversationId,
            runId: labRun.runId ?? null,
            selectedAgentId: labRun.agentId,
            selectedSkill: labRun.skill,
            reviewStatus,
            reviewNotes,
          },
        },
      }
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Task create failed (${res.status})`)
      setMessage(`Created improvement task ${data?.data?.id ?? data?.id ?? ''}`.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create improvement task')
    } finally {
      setTaskCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Platform / Agents</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Skill Tasting Lab</h1>
          <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">
            Select an agent, select one allowlisted skill, run a sandbox tasting conversation, then turn weak behaviour into a routed skill-improvement task. The lab does not edit skills directly; it captures evidence for Pip/the owning agent to review and patch safely. No live publishing, sends, spend, billing, destructive work, secrets, or production deploys from here.
          </p>
        </div>
        <Link href="/admin/agents" className="pib-btn-secondary inline-flex items-center gap-1 text-sm">
          <span className="material-symbols-outlined text-[16px]">group_work</span>
          Agent team
        </Link>
      </div>

      {(error || message) && (
        <div className={[
          'rounded-lg border p-3 text-sm',
          error ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
        ].join(' ')}>
          {error || message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <form onSubmit={startRun} className="pib-card space-y-5 p-5">
          <div>
            <h2 className="text-sm font-semibold text-on-surface">Tasting setup</h2>
            <p className="mt-1 text-xs text-on-surface-variant">The generated prompt wraps your scenario in hard sandbox guardrails before it reaches the agent.</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Agent</span>
            <select className="pib-input w-full text-sm" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} disabled={loading || starting}>
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>{agent.name} ({agent.agentId})</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Allowlisted skill</span>
            <select className="pib-input w-full text-sm" value={selectedSkill} onChange={(e) => setSelectedSkill(e.target.value)} disabled={policyLoading || starting || skillOptions.length === 0}>
              {skillOptions.map((skill) => (
                <option key={skill} value={skill}>{skill}</option>
              ))}
            </select>
            <p className="text-[11px] text-on-surface-variant">
              {policyLoading ? 'Loading policy…' : `${skillOptions.length} selectable skill${skillOptions.length === 1 ? '' : 's'} from policy/runtime allowlist.`}
            </p>
          </label>

          <div className="space-y-2">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Scenario templates</span>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {SCENARIO_TEMPLATES.map((scenario) => (
                <button key={scenario.label} type="button" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-left text-xs text-on-surface-variant transition hover:border-[var(--color-accent-v2)]/50 hover:text-on-surface" onClick={() => setPrompt(scenario.prompt)}>
                  {scenario.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Tester prompt</span>
            <textarea className="pib-input min-h-36 w-full resize-y text-sm" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask the selected agent to perform a safe, reviewable task with this one skill." />
          </label>

          <details className="rounded-lg border border-[var(--color-card-border)] bg-black/10 p-3">
            <summary className="cursor-pointer text-xs font-label uppercase tracking-wide text-on-surface-variant">Preview sandbox prompt</summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-on-surface-variant">{sandboxPrompt || 'Select a skill to preview the guarded prompt.'}</pre>
          </details>

          <button type="submit" className="pib-btn-primary w-full justify-center text-sm" disabled={loading || starting || !selectedAgentId || !selectedSkill || !prompt.trim()}>
            {starting ? 'Starting sandbox…' : 'Start tasting run'}
          </button>
        </form>

        <section className="min-h-[620px] overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]">
          {labRun && session?.uid ? (
            <UnifiedChat
              key={labRun.conversationId}
              orgId={PLATFORM_ORG_ID}
              orgName="Partners in Biz"
              currentUserUid={session.uid}
              currentUserDisplayName={displayName(session)}
              initialConvId={labRun.conversationId}
              initialAgentId={labRun.agentId}
              allowDeleteConversations
              compact
            />
          ) : (
            <div className="flex h-full min-h-[620px] items-center justify-center p-8 text-center">
              <div className="max-w-md space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                  <span className="material-symbols-outlined">science</span>
                </div>
                <h2 className="text-lg font-semibold text-on-surface">No tasting run yet</h2>
                <p className="text-sm text-on-surface-variant">Start a sandbox run and the live conversation will appear here. The run is scoped to the parent platform workspace, not a client account.</p>
              </div>
            </div>
          )}
        </section>
      </div>


      <section className="pib-card space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-on-surface">Agent Learning Review schedule</h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            This schedules the PiB “scan → stage → review” loop under Pip. Pick whether it runs for the system as a whole or a scoped organisation being administered. Runs only create reviewable proposals/tasks; they do not mutate skills, publish, send, spend, bill, deploy, or change secrets.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_260px] lg:items-end">
          <label className="space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Scope</span>
            <select className="pib-input w-full text-sm" value={learningScope} onChange={(e) => setLearningScope(e.target.value as 'system' | 'client')}>
              <option value="system">System / PiB parent</option>
              <option value="client">Scoped organisation</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Scoped organisation</span>
            <select className="pib-input w-full text-sm" value={learningOrgId} onChange={(e) => setLearningOrgId(e.target.value)} disabled={learningScope === 'system'}>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name} ({org.id})</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">When to run</span>
            <input
              className="pib-input w-full text-sm font-mono"
              value={learningSchedule}
              onChange={(e) => setLearningSchedule(e.target.value)}
              list="learning-review-schedules"
              placeholder="0 7 * * 1"
            />
            <datalist id="learning-review-schedules">
              {LEARNING_REVIEW_SCHEDULES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </datalist>
            <p className="text-[11px] text-on-surface-variant">Use a preset or any Hermes cron expression, e.g. monthly, weekly, or post-campaign one-off ISO timestamp.</p>
          </label>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Optional focus</span>
            <textarea className="pib-input min-h-20 w-full resize-y text-sm" value={learningFocus} onChange={(e) => setLearningFocus(e.target.value)} placeholder="Example: review repeated blockers from the last month, client voice lessons, or platform skill/runbook improvement opportunities." />
          </label>
          <button type="button" className="pib-btn-primary whitespace-nowrap text-sm" onClick={createLearningReviewJob} disabled={learningCreating || (learningScope === 'client' && !learningOrgId)}>
            {learningCreating ? 'Scheduling…' : 'Schedule learning review'}
          </button>
        </div>
        <details className="rounded-lg border border-[var(--color-card-border)] bg-black/10 p-3">
          <summary className="cursor-pointer text-xs font-label uppercase tracking-wide text-on-surface-variant">Preview scheduled prompt</summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-on-surface-variant">{buildLearningReviewPrompt(learningScope, organizations.find((org) => org.id === learningOrgId), learningFocus)}</pre>
        </details>
      </section>

      <section className="pib-card space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-on-surface">Review outcome</h2>
          <p className="mt-1 text-xs text-on-surface-variant">Use this after reading the transcript. If the agent produced “Skill improvement notes”, paste them below. Creating the follow-up does not edit the skill immediately; it creates a Pip routing task with the transcript, notes, and safety gates linked.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Verdict</span>
            <select className="pib-input w-full text-sm" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
              {REVIEW_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Notes</span>
            <textarea className="pib-input min-h-20 w-full resize-y text-sm" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Paste the agent’s Skill improvement notes, plus what felt wrong, stale, unsafe, or off-brand." />
          </label>
          <button type="button" className="pib-btn-secondary whitespace-nowrap text-sm" onClick={createImprovementTask} disabled={!labRun || taskCreating}>
            {taskCreating ? 'Creating…' : 'Create improvement task'}
          </button>
        </div>
      </section>
    </div>
  )
}
