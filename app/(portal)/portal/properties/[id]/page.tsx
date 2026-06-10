'use client'
export const dynamic = 'force-dynamic'

import { PropertyDetailWorkspace } from '@/components/properties/PropertyDetailWorkspace'

export default function PortalPropertyDetail() {
  return <PropertyDetailWorkspace backHref="/portal/properties" />
}
