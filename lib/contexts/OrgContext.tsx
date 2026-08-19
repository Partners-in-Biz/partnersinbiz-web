'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { OrganizationSummary } from '@/lib/organizations/types'

const LS_KEY = 'pib_selected_org'

interface OrgContextValue {
  selectedOrgId: string
  orgName: string
  orgs: OrganizationSummary[]
  setOrg: (id: string, name: string) => void
  clearOrg: () => void
  // Deprecated legacy properties for backward compatibility
  orgId: string
}

const OrgContext = createContext<OrgContextValue>({
  selectedOrgId: '',
  orgName: '',
  orgs: [],
  setOrg: () => {},
  clearOrg: () => {},
  orgId: '',
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [orgName, setOrgName] = useState('')
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([])

  // Fetch organizations on mount
  useEffect(() => {
    fetch('/api/v1/organizations')
      .then((r) => r.json())
      .then((b) => setOrgs(b.data ?? []))
      .catch(() => {})
  }, [])

  // Rehydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as { id: string; name: string }
        if (parsed.id) {
          // localStorage rehydration is intentionally a one-time client sync.
          setSelectedOrgId(parsed.id)
          setOrgName(parsed.name ?? '')
        }
      }
    } catch {
      // ignore corrupt storage
    }
  }, [])

  const setOrg = useCallback((id: string, name: string) => {
    setSelectedOrgId(id)
    setOrgName(name)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ id, name }))
    } catch {
      // ignore storage errors
    }
  }, [])

  const clearOrg = useCallback(() => {
    setSelectedOrgId('')
    setOrgName('')
    try {
      localStorage.removeItem(LS_KEY)
    } catch {}
  }, [])

  return (
    <OrgContext.Provider value={{ selectedOrgId, orgName, orgs, setOrg, clearOrg, orgId: selectedOrgId }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg(): OrgContextValue {
  return useContext(OrgContext)
}
