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
        className="pib-card cursor-pointer select-none transition-all duration-150 hover:border-[var(--color-accent-v2)]"
        style={{ padding: '10px', borderLeft: `3px solid ${priorityColor}` }}
        onClick={onClick}
      >
        <p className="text-sm font-medium text-on-surface mb-2 leading-snug">{task.title}</p>
        {(startDateTimeLabel || endDateTimeLabel) && (
          <div className="mb-2 grid gap-1 text-[10px] text-on-surface-variant">
            {startDateTimeLabel && (
              <div className="flex items-center justify-between gap-2">
                <span className="font-label uppercase tracking-wide">Start</span>
                <span className="text-right text-on-surface">{startDateTimeLabel}</span>
              </div>
            )}
            {endDateTimeLabel && (
              <div className="flex items-center justify-between gap-2">
                <span className="font-label uppercase tracking-wide">End</span>
                <span className="text-right text-on-surface">{endDateTimeLabel}</span>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link
            href={projectHref ?? `/portal/projects/${projectId}`}
            onClick={e => e.stopPropagation()}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full truncate max-w-[140px]"
            style={{ background: badgeBg, color: badgeText }}
          >
            {projectName}
          </Link>
          <span
            className="shrink-0 w-2 h-2 rounded-full"
            style={{ background: priorityColor }}
            title={task.priority ?? 'normal'}
          />
        </div>
      </div>
    </div>
  )
}
