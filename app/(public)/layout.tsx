import { cookies, headers } from 'next/headers'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { MaintenanceShell } from '@/components/governance/MaintenanceShell'
import { getMaintenanceState, isMaintenanceActiveNow, requestBypassesMaintenance } from '@/lib/governance/maintenance'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

const PUBLIC_MATERIAL_SYMBOL_NAMES = [
  'account_tree',
  'add',
  'arrow_back',
  'arrow_downward',
  'arrow_forward',
  'arrow_outward',
  'arrow_upward',
  'auto_awesome',
  'autorenew',
  'bolt',
  'calendar_month',
  'campaign',
  'chat',
  'check',
  'check_circle',
  'dashboard',
  'delete',
  'edit_note',
  'event',
  'event_available',
  'event_note',
  'expand_more',
  'explore',
  'fact_check',
  'format_quote',
  'groups',
  'handshake',
  'help_outline',
  'hub',
  'language',
  'lock',
  'mail',
  'manage_search',
  'open_in_new',
  'page_info',
  'payments',
  'phone_iphone',
  'public',
  'request_quote',
  'robot_2',
  'search',
  'send',
  'sports_martial_arts',
  'stars',
  'storefront',
  'trending_up',
  'tune',
  'verified',
  'warning',
] as const

const PUBLIC_MATERIAL_SYMBOLS =
  `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap&icon_names=${PUBLIC_MATERIAL_SYMBOL_NAMES.join(',')}`

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const maintenance = await getMaintenanceState()
  if (isMaintenanceActiveNow(maintenance)) {
    const headerStore = await headers()
    const cookieStore = await cookies()
    const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
    const sessionCookie = cookieStore.get(cookieName)?.value
    let role: 'admin' | 'client' | 'ai' | null = null

    if (sessionCookie) {
      try {
        const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
        const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
        role = userDoc.exists && userDoc.data()?.role === 'admin' ? 'admin' : 'client'
      } catch {
        role = null
      }
    }

    if (!requestBypassesMaintenance(headerStore, maintenance, role)) {
      return <MaintenanceShell message={maintenance.message} />
    }
  }

  return (
    <>
      <link rel="stylesheet" href={PUBLIC_MATERIAL_SYMBOLS} />
      <Navbar />
      {children}
      <Footer />
    </>
  )
}
