'use client'

import Link from 'next/link'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { projectBadgeColor } from '@/lib/projects/projectBadgeColor'
import { formatTaskDateTime } from '@/lib/tasks/dateTimeDisplay'
import type { Task } from '@/components/kanban/types'

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444',
  high:   '#f97316',
  medium: '#eab308',
  normal: '#60a5fa',
  low:    '#6b7280',
}

interface CrossProjectTaskCardProps {
  task: Task
  projectId: string
  projectName: string
  projectHref?: string
  onClick: () => void
}

export function CrossProjectTaskCard({ task, projectId, projectName, projectHref, onClick }: CrossProjectTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const { text: badgeText, bg: badgeBg } = projectBadgeColor(projectId)
  const priorityColor = PRIORITY_COLOR[task.priority ?? 'normal'] ?? PRIORITY_COLOR.normal
  const startDateTimeLabel = formatTaskDateTime(task.startDate)
  const endDateTimeLabel = formatTaskDateTime(task.completedAt ?? task.agentOutput?.completedAt ?? task.endDate ?? task.dueDate)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <div
        className="pib-card cursor-pointer select-none transition-all duration-150 hover:border-[var(--color-pib-cyan)]/50"
        style={{ padding: '8px 9px', borderLeft: `2px solid ${priorityColor}` }}
        onClick={onClick}
      >
        <p className="mb-1.5 text-[13px] font-medium leading-snug text-[var(--color-pib-text)]">{task.title}</p>
        {(startDateTimeLabel || endDateTimeLabel) && (
          <div className="mb-1.5 grid gap-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
            {startDateTimeLabel && (
              <div className="flex items-center justify-between gap-2">
                <span className="pib-label">Start</span>
                <span className="text-right text-[var(--color-pib-text)]">{startDateTimeLabel}</span>
              </div>
            )}
            {endDateTimeLabel && (
              <div className="flex items-center justify-between gap-2">
                <span className="pib-label">End</span>
                <span className="text-right text-[var(--color-pib-text)]">{endDateTimeLabel}</span>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link
            href={projectHref ?? `/portal/projects/${projectId}`}
            onClick={e => e.stopPropagation()}
            className="max-w-[140px] truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: badgeBg, color: badgeText }}
          >
            {projectName}
          </Link>
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-md"
            style={{ background: priorityColor }}
            title={task.priority ?? 'normal'}
          />
        </div>
      </div>
    </div>
  )
}
