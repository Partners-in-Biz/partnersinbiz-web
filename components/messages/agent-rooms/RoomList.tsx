'use client'

import { useCallback, useEffect, useState } from 'react'
import { useFeatureFlag } from '@/components/portal/FeatureFlagsProvider'
import type { AgentRoom } from '@/lib/agent-rooms/types'
import { CreateRoomDialog } from './CreateRoomDialog'
import { RoomDriftBanner } from './RoomDriftBanner'
import { RoomMemberBadges } from './RoomMemberBadges'

type RoomRow = AgentRoom & {
  needsYou?: boolean
  drift?: { projectionId: string; profile: string } | null
}

function RoomSection({
  title,
  rooms,
  orgId,
  activeConversationId,
  onOpenConversation,
  onDriftResolved,
}: {
  title: string
  rooms: RoomRow[]
  orgId: string
  activeConversationId?: string | null
  onOpenConversation: (conversationId: string) => void
  onDriftResolved: () => void
}) {
  if (rooms.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">{title}</p>
      <ul className="space-y-1.5">
        {rooms.map((room) => (
          <li key={room.roomId}>
            <button
              type="button"
              aria-label={`Open ${room.name}`}
              onClick={() => room.conversationId && onOpenConversation(room.conversationId)}
              className={`flex w-full flex-col gap-1 rounded-[4px] border px-2 py-1.5 text-left ${
                room.conversationId === activeConversationId
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)]'
              }`}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-sm text-[var(--color-pib-text)]">{room.name}</span>
                {room.needsYou && (
                  <span className="shrink-0 rounded-[4px] border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    Needs you
                  </span>
                )}
              </span>
              <RoomMemberBadges members={room.members} />
            </button>
            {room.drift && (
              <div className="mt-1">
                <RoomDriftBanner
                  orgId={orgId}
                  projectionId={room.drift.projectionId}
                  profile={room.drift.profile}
                  onResolved={onDriftResolved}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RoomList({
  orgId,
  activeConversationId,
  onOpenConversation,
  canCreateOrgRooms = false,
}: {
  orgId: string
  activeConversationId?: string | null
  onOpenConversation: (conversationId: string) => void
  canCreateOrgRooms?: boolean
}) {
  const personalRoomsEnabled = useFeatureFlag('personalAgentRoomsEnabled')
  const [rooms, setRooms] = useState<RoomRow[] | null>(null)
  const [hidden, setHidden] = useState(false)
  const [creating, setCreating] = useState(false)

  const loadRooms = useCallback(async (): Promise<boolean> => {
    const response = await fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/agent-rooms`)
    if (response.status === 404) {
      setHidden(true)
      setRooms(null)
      return false
    }
    if (!response.ok) {
      setRooms([])
      return false
    }
    const body = await response.json().catch(() => null)
    const rows = Array.isArray(body?.data?.rooms) ? body.data.rooms : []
    setHidden(false)
    setRooms(rows.filter((row: unknown): row is RoomRow => (
      Boolean(row && typeof row === 'object' && typeof (row as RoomRow).roomId === 'string')
    )))
    return true
  }, [orgId])

  useEffect(() => {
    let cancelled = false
    void loadRooms().then((ok) => {
      if (cancelled && !ok) return
    })
    return () => {
      cancelled = true
    }
  }, [loadRooms])

  if (hidden || rooms === null) return null

  const active = rooms.filter((room) => room.status !== 'archived')
  const myRooms = active.filter((room) => room.accessScope === 'personal')
  const orgRooms = active.filter((room) => room.accessScope !== 'personal')
  const canCreate = canCreateOrgRooms || personalRoomsEnabled

  return (
    <section className="space-y-2 px-1 pb-2" aria-label="Agent rooms">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Rooms</p>
        {canCreate && (
          <button
            type="button"
            className="btn-pib-secondary btn-pib-sm"
            onClick={() => setCreating(true)}
          >
            New room
          </button>
        )}
      </div>
      {active.length === 0 ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">No rooms yet.</p>
      ) : personalRoomsEnabled ? (
        <div className="space-y-3">
          <RoomSection
            title="My rooms"
            rooms={myRooms}
            orgId={orgId}
            activeConversationId={activeConversationId}
            onOpenConversation={onOpenConversation}
            onDriftResolved={() => void loadRooms()}
          />
          <RoomSection
            title="Org rooms"
            rooms={orgRooms}
            orgId={orgId}
            activeConversationId={activeConversationId}
            onOpenConversation={onOpenConversation}
            onDriftResolved={() => void loadRooms()}
          />
        </div>
      ) : (
        <ul className="space-y-1.5">
          {active.map((room) => (
            <li key={room.roomId}>
              <button
                type="button"
                aria-label={`Open ${room.name}`}
                onClick={() => room.conversationId && onOpenConversation(room.conversationId)}
                className={`flex w-full flex-col gap-1 rounded-[4px] border px-2 py-1.5 text-left ${
                  room.conversationId === activeConversationId
                    ? 'border-primary/30 bg-primary/10'
                    : 'border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)]'
                }`}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm text-[var(--color-pib-text)]">{room.name}</span>
                  {room.needsYou && (
                    <span className="shrink-0 rounded-[4px] border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      Needs you
                    </span>
                  )}
                </span>
                <RoomMemberBadges members={room.members} />
              </button>
              {room.drift && (
                <div className="mt-1">
                  <RoomDriftBanner
                    orgId={orgId}
                    projectionId={room.drift.projectionId}
                    profile={room.drift.profile}
                    onResolved={() => void loadRooms()}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <CreateRoomDialog
          orgId={orgId}
          canCreateOrgRooms={canCreateOrgRooms}
          personalRoomsEnabled={personalRoomsEnabled}
          onClose={() => setCreating(false)}
          onCreated={(conversationId) => {
            setCreating(false)
            void loadRooms()
            onOpenConversation(conversationId)
          }}
        />
      )}
    </section>
  )
}
