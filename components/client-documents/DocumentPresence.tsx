'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '@/lib/firebase/client'
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'

interface CursorPosition {
  /** Fractions (0–1) of the tracked surface, so positions map across viewports. */
  xRatio: number
  yRatio: number
  updatedAt: number
}

interface PresenceRecord {
  userId: string
  name: string
  seenAt: Timestamp | null
  expiresAt: string
  cursor?: CursorPosition | null
}

interface Props {
  documentId: string
  currentUserId: string
  currentUserName: string
  /**
   * Optional ref to the element whose bounding box cursor positions are measured
   * against (US-201). When provided, live cursors are rendered as an overlay
   * inside this element. When omitted, only the presence avatars render.
   */
  surfaceRef?: React.RefObject<HTMLElement | null>
}

function getInitials(name: string): string {
  return name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
}

const ACCENT_COLORS = [
  '#8b5cf6', // violet
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#6366f1', // indigo
]

const ACCENT_BG_CLASSES = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
]

function colorIndexForUser(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % ACCENT_COLORS.length
}

const HEARTBEAT_MS = 20_000
const EXPIRY_MS = 30_000
const CURSOR_THROTTLE_MS = 60
/** A remote cursor older than this is considered idle and is not drawn. */
const CURSOR_STALE_MS = 8_000
/** No successful snapshot within this window ⇒ surface the connection-lost notice. */
const CONNECTION_LOST_MS = 45_000

export function DocumentPresence({
  documentId,
  currentUserId,
  currentUserName,
  surfaceRef,
}: Props) {
  const [others, setOthers] = useState<PresenceRecord[]>([])
  const [connectionLost, setConnectionLost] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const myDocRef = useRef<ReturnType<typeof doc> | null>(null)
  const lastCursorWriteRef = useRef(0)
  // Initialised lazily in effects to avoid calling Date.now() during render.
  const lastSnapshotAtRef = useRef(0)
  // Re-derived on each tick so cursors fade out without a new snapshot.
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    if (!currentUserId || !documentId) return

    const presenceCol = collection(db, 'document_presence', documentId, 'users')
    const myDoc = doc(presenceCol, currentUserId)
    myDocRef.current = myDoc

    async function writePresence() {
      const expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString()
      await setDoc(
        myDoc,
        {
          userId: currentUserId,
          name: currentUserName,
          seenAt: serverTimestamp(),
          expiresAt,
        },
        { merge: true },
      )
    }

    writePresence().catch(() => {})

    intervalRef.current = setInterval(() => {
      writePresence().catch(() => {})
    }, HEARTBEAT_MS)

    const unsubscribe = onSnapshot(
      presenceCol,
      (snapshot) => {
        lastSnapshotAtRef.current = Date.now()
        setConnectionLost(false)
        const now = Date.now()
        const active: PresenceRecord[] = []
        for (const d of snapshot.docs) {
          const data = d.data() as PresenceRecord
          if (data.userId === currentUserId) continue
          const expiry = data.expiresAt ? new Date(data.expiresAt).getTime() : 0
          if (expiry < now) continue
          active.push(data)
        }
        setOthers(active)
      },
      () => {
        // Firestore listener error ⇒ we've lost the realtime connection.
        setConnectionLost(true)
      },
    )

    return () => {
      unsubscribe()
      if (intervalRef.current) clearInterval(intervalRef.current)
      deleteDoc(myDoc).catch(() => {})
      myDocRef.current = null
    }
  }, [documentId, currentUserId, currentUserName])

  // Broadcast this user's cursor position over the shared surface (US-201).
  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const surface = surfaceRef?.current
      const myDoc = myDocRef.current
      if (!surface || !myDoc) return
      const now = Date.now()
      if (now - lastCursorWriteRef.current < CURSOR_THROTTLE_MS) return
      const rect = surface.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const xRatio = (e.clientX - rect.left) / rect.width
      const yRatio = (e.clientY - rect.top) / rect.height
      if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return
      lastCursorWriteRef.current = now
      updateDoc(myDoc, {
        cursor: { xRatio, yRatio, updatedAt: now },
      }).catch(() => {})
    },
    [surfaceRef],
  )

  useEffect(() => {
    const surface = surfaceRef?.current
    if (!surface) return
    surface.addEventListener('pointermove', handlePointerMove)
    const clearCursor = () => {
      const myDoc = myDocRef.current
      if (myDoc) updateDoc(myDoc, { cursor: null }).catch(() => {})
    }
    surface.addEventListener('pointerleave', clearCursor)
    return () => {
      surface.removeEventListener('pointermove', handlePointerMove)
      surface.removeEventListener('pointerleave', clearCursor)
    }
  }, [surfaceRef, handlePointerMove])

  // Re-render periodically so stale cursors fade and connection-loss is detected
  // even if no new snapshot arrives.
  useEffect(() => {
    lastSnapshotAtRef.current = Date.now()
    const t = setInterval(() => {
      const now = Date.now()
      if (now - lastSnapshotAtRef.current > CONNECTION_LOST_MS) {
        setConnectionLost(true)
      }
      setNowTick(now)
    }, 2_000)
    return () => clearInterval(t)
  }, [])

  const now = nowTick
  const liveCursors = surfaceRef
    ? others.filter(
        (u) => u.cursor && typeof u.cursor.xRatio === 'number' && now - u.cursor.updatedAt < CURSOR_STALE_MS,
      )
    : []

  const visible = others.slice(0, 3)
  const overflow = others.length - visible.length

  return (
    <>
      {(others.length > 0 || connectionLost) && (
        <div className="flex items-center gap-2">
          {others.length > 0 && (
            <>
              <div className="flex items-center">
                {visible.map((user, i) => (
                  <div
                    key={user.userId}
                    title={user.name}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-[var(--color-pib-surface)] ${ACCENT_BG_CLASSES[colorIndexForUser(user.userId)]} ${i > 0 ? '-ml-2' : ''}`}
                  >
                    {getInitials(user.name) || '?'}
                  </div>
                ))}
                {overflow > 0 && (
                  <div
                    className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-pib-line)] text-xs font-semibold text-[var(--color-pib-text-muted)] ring-2 ring-[var(--color-pib-surface)]"
                    title={`${overflow} more viewer${overflow === 1 ? '' : 's'}`}
                  >
                    +{overflow}
                  </div>
                )}
              </div>
              <span className="text-xs text-[var(--color-pib-text-muted)]">
                {others.length === 1 ? `${others[0].name} is also viewing` : `${others.length} others viewing`}
              </span>
            </>
          )}
          {connectionLost && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"
              title="Live presence lost connection — reconnecting"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden>
                cloud_off
              </span>
              Reconnecting…
            </span>
          )}
        </div>
      )}

      {/* Live cursor overlay (US-201) */}
      {surfaceRef && <LiveCursorOverlay surfaceRef={surfaceRef} cursors={liveCursors} />}
    </>
  )
}

function LiveCursorOverlay({
  surfaceRef,
  cursors,
}: {
  surfaceRef: React.RefObject<HTMLElement | null>
  cursors: PresenceRecord[]
}) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  // Track the surface position so the fixed-position cursors stay aligned on
  // scroll/resize.
  useEffect(() => {
    const measure = () => {
      const el = surfaceRef.current
      if (!el) return setRect(null)
      const r = el.getBoundingClientRect()
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const interval = setInterval(measure, 500)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      clearInterval(interval)
    }
  }, [surfaceRef])

  if (!rect || cursors.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      {cursors.map((user) => {
        const cursor = user.cursor!
        const left = rect.left + cursor.xRatio * rect.width
        const top = rect.top + cursor.yRatio * rect.height
        const color = ACCENT_COLORS[colorIndexForUser(user.userId)]
        return (
          <div
            key={user.userId}
            className="absolute transition-[left,top] duration-75 ease-linear"
            style={{ left, top, transform: 'translate(-2px, -2px)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M5.5 3.5L19 12.5L12 13.5L8.5 20L5.5 3.5Z"
                fill={color}
                stroke="#fff"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="ml-3 mt-0.5 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
              style={{ background: color }}
            >
              {user.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
