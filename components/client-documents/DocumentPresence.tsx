'use client'

import { useEffect, useRef, useState } from 'react'
import { db } from '@/lib/firebase/client'
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'

interface PresenceRecord {
  userId: string
  name: string
  seenAt: Timestamp | null
  expiresAt: string
}

interface Props {
  documentId: string
  currentUserId: string
  currentUserName: string
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
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
]

function colorForUser(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length]
}

const HEARTBEAT_MS = 20_000
const EXPIRY_MS = 30_000

export function DocumentPresence({ documentId, currentUserId, currentUserName }: Props) {
  const [others, setOthers] = useState<PresenceRecord[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!currentUserId || !documentId) return

    const presenceCol = collection(db, 'document_presence', documentId, 'users')
    const myDoc = doc(presenceCol, currentUserId)

    async function writePresence() {
      const expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString()
      await setDoc(myDoc, {
        userId: currentUserId,
        name: currentUserName,
        seenAt: serverTimestamp(),
        expiresAt,
      })
    }

    // Write on mount
    writePresence().catch(() => {})

    // Heartbeat every 20s
    intervalRef.current = setInterval(() => {
      writePresence().catch(() => {})
    }, HEARTBEAT_MS)

    // Watch the collection for all users
    const unsubscribe = onSnapshot(presenceCol, (snapshot) => {
      const now = Date.now()
      const active: PresenceRecord[] = []
      for (const d of snapshot.docs) {
        const data = d.data() as PresenceRecord
        // Filter out current user and expired records
        if (data.userId === currentUserId) continue
        const expiry = data.expiresAt ? new Date(data.expiresAt).getTime() : 0
        if (expiry < now) continue
        active.push(data)
      }
      setOthers(active)
    })

    return () => {
      unsubscribe()
      if (intervalRef.current) clearInterval(intervalRef.current)
      deleteDoc(myDoc).catch(() => {})
    }
  }, [documentId, currentUserId, currentUserName])

  if (others.length === 0) return null

  const visible = others.slice(0, 3)
  const overflow = others.length - visible.length

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        {visible.map((user, i) => (
          <div
            key={user.userId}
            title={user.name}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-[var(--color-pib-surface)] ${colorForUser(user.userId)} ${i > 0 ? '-ml-2' : ''}`}
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
        {others.length === 1
          ? `${others[0].name} is also viewing`
          : `${others.length} others viewing`}
      </span>
    </div>
  )
}
