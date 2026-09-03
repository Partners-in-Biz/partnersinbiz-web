'use client'

import { Icon } from '@/components/studio'
import { useEffect, useRef, useState } from 'react'

import type { ProjectChatProgress, ProjectChatTaskItem, ProjectChatTaskState } from '@/lib/projects/chatProgress'

// Compatibility surface: Project Pulse and Living Thread remain exported while
// non-project objects use the generic Context Pulse and Context Dock.
export { ContextPulse } from '@/components/chat/context/ContextPulse'
export { ContextDock } from '@/components/chat/context/ContextDock'

export interface ProjectOption {
  id: string
  label: string
}

const STATE_LABEL: Record<ProjectChatTaskState, string> = {
  ready: 'Ready',
  running: 'In progress',
  waiting: 'Waiting',
  needs_input: 'Needs input',
  blocked: 'Blocked',
  review: 'Review',
  complete: 'Complete',
}

// Align with project board column colours (todo blue, in-progress amber, blocked red, review purple, done green).
const STATE_TONE: Record<ProjectChatTaskState, string> = {
  ready: 'text-sky-300',
  running: 'text-[var(--st-warning)]',
  waiting: 'text-[var(--color-pib-text-muted)]',
  needs_input: 'text-orange-200',
  blocked: 'text-red-300',
  review: 'text-[var(--st-info)]',
  complete: 'text-emerald-300',
}

function completionPercent(progress: ProjectChatProgress) {
  return progress.counts.total > 0
    ? Math.round((progress.counts.complete / progress.counts.total) * 100)
    : 0
}

function isApprovalTask(task: ProjectChatTaskItem) {
  return task.approvalStatus === 'pending'
    || task.labels?.some((label) => /approval-gate|approval-required|client-approval|required-approval/.test(label.toLowerCase())) === true
}

export function ProjectPulse({
  progress,
  projects,
  activeProjectId,
  onProjectChange,
  onOpen,
}: {
  progress: ProjectChatProgress
  projects: ProjectOption[]
  activeProjectId: string
  onProjectChange: (projectId: string) => void
  onOpen: () => void
}) {
  const focusTask = progress.attention ?? progress.next
  return (
    <div data-testid="project-pulse" className="shrink-0 border-b border-[var(--color-card-border)] bg-black/[0.08] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon name="folder_managed" className="shrink-0 text-[15px] text-primary" />
        {projects.length > 1 ? (
          <select
            aria-label="Active project"
            value={activeProjectId}
            onChange={(event) => onProjectChange(event.target.value)}
            className="min-w-0 max-w-[190px] truncate bg-transparent text-xs font-medium text-[var(--color-pib-text)] outline-none"
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}
          </select>
        ) : (
          <span className="min-w-0 max-w-[190px] truncate text-xs font-medium text-[var(--color-pib-text)]">{progress.project.name}</span>
        )}
        <progress
          aria-label={`${progress.project.name} completion`}
          value={progress.counts.complete}
          max={Math.max(progress.counts.total, 1)}
          className="hidden h-1.5 min-w-[84px] flex-1 accent-[var(--color-primary)] sm:block"
        />
        <div className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-[var(--color-pib-text-muted)] sm:text-[11px]">
          <span>{progress.counts.complete}/{progress.counts.total} complete</span>
          {progress.counts.running > 0 && <span className="hidden md:inline">{progress.counts.running} running</span>}
          {progress.counts.needsYou > 0 && <span className="text-[var(--st-warning)]">{progress.counts.needsYou} needs you</span>}
          <span className="sr-only">{completionPercent(progress)} percent complete</span>
        </div>
        <button
          type="button"
          aria-label="Open project lens"
          onClick={onOpen}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-white/[0.07] hover:text-[var(--color-pib-text)]"
        >
          <Icon name="dock_to_right" className="text-[16px]" />
        </button>
      </div>
      {focusTask && (
        <p className="mt-1 truncate pl-6 text-[10px] text-[var(--color-pib-text-muted)]">
          {progress.attention ? 'Attention' : 'Next'}: <span className={STATE_TONE[focusTask.state]}>{focusTask.title} · {STATE_LABEL[focusTask.state]}</span>
        </p>
      )}
    </div>
  )
}

function TaskRow({ task, taskHref }: { task: ProjectChatTaskItem; taskHref: (taskId: string) => string }) {
  const [expanded, setExpanded] = useState(false)
  const model = task.agentModel?.trim()
  return (
    <li className="border-b border-white/[0.06] last:border-b-0">
      <button
        type="button"
        aria-label={`${expanded ? 'Hide' : 'Show'} details for ${task.title}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.035]"
      >
        <Icon name={task.state === 'complete' ? 'check_circle' : task.state === 'running' ? 'progress_activity' : task.state === 'blocked' || task.state === 'needs_input' ? 'error' : 'radio_button_unchecked'} className="text-[15px] text-[var(--color-pib-text-muted)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-[var(--color-pib-text)]">{task.title}</span>
          <span className="mt-0.5 block truncate text-[10px] text-[var(--color-pib-text-muted)]">{task.assigneeAgentId || 'Human task'}</span>
        </span>
        <span className={`shrink-0 text-[10px] ${STATE_TONE[task.state]}`}>{STATE_LABEL[task.state]}</span>
      </button>
      {expanded && (
        <div className="space-y-1 bg-black/15 px-10 pb-2.5 text-[10px] text-[var(--color-pib-text-muted)]">
          {model && <p>Model: <span className="text-[var(--color-pib-text)]">{model}</span></p>}
          {task.reviewerAgentId && <p>Reviewer: <span className="text-[var(--color-pib-text)]">{task.reviewerAgentId}</span></p>}
          {task.unresolvedDependencyIds.length > 0 && <p>Waiting on {task.unresolvedDependencyIds.length} task{task.unresolvedDependencyIds.length === 1 ? '' : 's'}</p>}
          <a href={taskHref(task.id)} className="inline-flex items-center gap-1 text-primary hover:underline">
            Open task <Icon name="open_in_new" className="text-[12px]" />
          </a>
        </div>
      )}
    </li>
  )
}

function LensGroup({ title, tasks, taskHref }: { title: string; tasks: ProjectChatTaskItem[]; taskHref: (taskId: string) => string }) {
  if (tasks.length === 0) return null
  return (
    <section>
      <div className="flex items-center justify-between px-3 py-2 text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
        <h3>{title}</h3><span>{tasks.length}</span>
      </div>
      <ul className="border-y border-white/[0.06]">{tasks.map((task) => <TaskRow key={task.id} task={task} taskHref={taskHref} />)}</ul>
    </section>
  )
}

export function ProjectLens({
  progress,
  open,
  onClose,
  onTaskAction,
  taskHref,
  canApprove = true,
}: {
  progress: ProjectChatProgress
  open: boolean
  onClose: () => void
  onTaskAction: (task: ProjectChatTaskItem) => void
  taskHref: (taskId: string) => string
  canApprove?: boolean
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null
  const now = progress.tasks.filter((task) => ['ready', 'running', 'review', 'needs_input', 'blocked'].includes(task.state))
  const waiting = progress.tasks.filter((task) => task.state === 'waiting')
  const done = progress.tasks.filter((task) => task.state === 'complete')
  const attentionTask = progress.tasks.find((task) => task.state === 'needs_input')
    ?? progress.tasks.find((task) => task.state === 'blocked')
  const attentionIsApproval = attentionTask ? isApprovalTask(attentionTask) : false
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`${progress.project.name} project tasks`}
      className="fixed inset-x-2 bottom-2 top-[14%] z-40 flex flex-col overflow-hidden rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-surface,#151515)] lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[320px] lg:rounded-none lg:rounded-r-xl"
    >
      <header className="shrink-0 border-b border-[var(--color-card-border)] px-3 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium text-[var(--color-pib-text)]">{progress.project.name}</h2>
            <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">{progress.counts.complete}/{progress.counts.total} verified complete</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close project lens" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-white/[0.07]">
            <Icon name="close" className="text-[17px]" />
          </button>
        </div>
        <progress value={progress.counts.complete} max={Math.max(progress.counts.total, 1)} className="mt-2 h-1.5 w-full accent-[var(--color-primary)]" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <LensGroup title="Now" tasks={now} taskHref={taskHref} />
        <LensGroup title="Waiting" tasks={waiting} taskHref={taskHref} />
        <LensGroup title="Done" tasks={done} taskHref={taskHref} />
      </div>
      {attentionTask && (
        <footer className="shrink-0 border-t border-[var(--color-card-border)] p-3">
          {!attentionIsApproval || canApprove ? (
            <button type="button" onClick={() => onTaskAction(attentionTask)} className="w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-on-primary hover:opacity-90">
              {attentionIsApproval ? 'Approve next step' : 'Provide input'}
            </button>
          ) : (
            <a href={taskHref(attentionTask.id)} className="block w-full rounded-md border border-amber-300/30 px-3 py-2 text-center text-xs font-medium text-[var(--st-warning)] hover:bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]">Review blocker</a>
          )}
        </footer>
      )}
    </aside>
  )
}

function artifactFor(task: ProjectChatTaskItem) {
  return task.agentOutput?.artifacts?.find((artifact) => artifact.ref && (artifact.type === 'url' || /^https?:\/\//.test(artifact.ref)))
}

export function LivingTaskBundle({
  tasks,
  onTaskAction,
  taskHref,
  canApprove = true,
}: {
  tasks: ProjectChatTaskItem[]
  onTaskAction: (task: ProjectChatTaskItem) => void
  taskHref: (taskId: string) => string
  canApprove?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  if (tasks.length === 0) return null
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const attentionTask = tasks.find((task) => task.state === 'needs_input')
    ?? tasks.find((task) => task.state === 'blocked')
  const attentionIsApproval = attentionTask ? isApprovalTask(attentionTask) : false
  return (
    <div className="ml-0 mt-2 max-w-full overflow-hidden rounded-lg border border-white/10 bg-black/15 lg:ml-10">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)]">
        <Icon name="account_tree" className="text-[15px] text-primary" />
        <span className="font-medium">{tasks.length} linked tasks</span>
        <span className="ml-auto text-[10px] text-[var(--color-pib-text-muted)]">{tasks.filter((task) => task.state === 'complete').length} complete</span>
        <Icon name={expanded ? 'expand_less' : 'expand_more'} className="text-[15px] text-[var(--color-pib-text-muted)]" />
      </button>
      {expanded && (
        <ol className="border-t border-white/[0.07]">
          {[...tasks].sort((left, right) => (left.chatOrigin?.sequence ?? 999) - (right.chatOrigin?.sequence ?? 999)).map((task, index) => {
            const artifact = artifactFor(task)
            const dependencyLabels = (task.dependsOn ?? []).map((id) => byId.get(id)?.title ?? id)
            return (
              <li key={task.id} className="grid gap-1 border-b border-white/[0.06] px-3 py-2 last:border-b-0 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:items-center">
                <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]">{index + 1}</span>
                <div className="min-w-0">
                  <a href={taskHref(task.id)} className={`block truncate text-xs font-medium hover:text-primary ${task.state === 'complete' ? 'text-[var(--color-pib-text-muted)] line-through' : 'text-[var(--color-pib-text)]'}`}>{task.title}</a>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--color-pib-text-muted)]">
                    {task.assigneeAgentId && <span>{task.assigneeAgentId}</span>}
                    {dependencyLabels.length > 0 && <span>After {dependencyLabels.join(', ')}</span>}
                    {artifact && <a href={artifact.ref} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">{artifact.label ?? 'Verified artifact'}</a>}
                  </p>
                </div>
                <span className={`text-[10px] ${STATE_TONE[task.state]}`}>{STATE_LABEL[task.state]}</span>
              </li>
            )
          })}
        </ol>
      )}
      {attentionTask && (
        <div className="flex flex-wrap items-center gap-3 border-t border-amber-400/25 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-3 py-2.5">
          <Icon name="approval" className="text-[17px] text-[var(--st-warning)]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--color-pib-text)]">{attentionIsApproval ? 'Your approval is needed' : 'Your input is needed'}</p>
            <p className="truncate text-[10px] text-[var(--color-pib-text-muted)]">{attentionTask.title}</p>
          </div>
          {!attentionIsApproval || canApprove ? (
            <button type="button" onClick={() => onTaskAction(attentionTask)} className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-on-primary hover:opacity-90">{attentionIsApproval ? 'Approve next step' : 'Provide input'}</button>
          ) : (
            <a href={taskHref(attentionTask.id)} className="rounded-md border border-amber-300/30 px-3 py-1.5 text-[11px] font-medium text-[var(--st-warning)] hover:bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]">Review blocker</a>
          )}
        </div>
      )}
    </div>
  )
}
