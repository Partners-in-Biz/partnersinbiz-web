'use client'
export const dynamic = 'force-dynamic'

import { PropertyConnectionsWorkspace } from '@/components/properties/PropertyConnectionsWorkspace'

export default function PortalPropertyConnections() {
  return <PropertyConnectionsWorkspace backHref="/portal/properties" />
}
