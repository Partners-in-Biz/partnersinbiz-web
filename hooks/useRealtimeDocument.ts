'use client'

import { useEffect, useState } from 'react'
import { db } from '@/lib/firebase/client'
import { doc, onSnapshot } from 'firebase/firestore'

interface RealtimeDocumentState {
  title: string | null
  status: string | null
  loading: boolean
}

export function useRealtimeDocument(documentId: string): RealtimeDocumentState {
  const [title, setTitle] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!documentId) {
      setLoading(false)
      return
    }

    const docRef = doc(db, 'client_documents', documentId)

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data()
          setTitle(typeof data.title === 'string' ? data.title : null)
          setStatus(typeof data.status === 'string' ? data.status : null)
        } else {
          setTitle(null)
          setStatus(null)
        }
        setLoading(false)
      },
      () => {
        // On error, stop loading — keep whatever state was set
        setLoading(false)
      },
    )

    return () => {
      unsubscribe()
    }
  }, [documentId])

  return { title, status, loading }
}
