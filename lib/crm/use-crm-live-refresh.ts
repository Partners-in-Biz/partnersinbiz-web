'use client'

import { useEffect, useRef } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { getClientDb } from '@/lib/firebase/config'
import { CRM_LIVE_UPDATES_COLLECTION, type CrmLiveEntity } from '@/lib/crm/live-update-keys'

type UseCrmLiveRefreshOptions = {
  orgId?: string
  entity: CrmLiveEntity
  enabled?: boolean
  onRefresh: () => void | Promise<void>
}

export function useCrmLiveRefresh({
  orgId,
  entity,
  enabled = true,
  onRefresh,
}: UseCrmLiveRefreshOptions): void {
  const refreshRef = useRef(onRefresh)

  useEffect(() => {
    refreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    const cleanOrgId = orgId?.trim()
    if (!enabled || !cleanOrgId) return

    let initialSnapshot = true
    const liveRef = doc(
      getClientDb(),
      'organizations',
      cleanOrgId,
      CRM_LIVE_UPDATES_COLLECTION,
      entity,
    )

    const unsubscribe = onSnapshot(
      liveRef,
      () => {
        if (initialSnapshot) {
          initialSnapshot = false
          return
        }
        void refreshRef.current()
      },
      () => {},
    )

    return () => unsubscribe()
  }, [enabled, entity, orgId])
}
