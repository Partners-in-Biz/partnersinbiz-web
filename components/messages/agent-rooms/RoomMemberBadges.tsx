'use client'

import type { AgentRoomMember } from '@/lib/agent-rooms/types'

function handleFor(member: AgentRoomMember): string {
  return member.deviceId ? `@${member.agentId}-${member.deviceId}` : `@${member.agentId}`
}

export function RoomMemberBadges({ members }: { members: AgentRoomMember[] }) {
  if (members.length === 0) return null
  return (
    <ul className="flex min-w-0 flex-wrap gap-1" aria-label="Room members">
      {members.map((member) => (
        <li
          key={`${member.agentId}:${member.deviceId ?? ''}`}
          className="inline-flex items-center rounded-[4px] border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-pib-text-muted)]"
        >
          {handleFor(member)}
        </li>
      ))}
    </ul>
  )
}
