import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

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
  'expand_more',
  'language',
  'mail',
  'manage_search',
  'page_info',
  'payments',
  'phone_iphone',
  'public',
  'request_quote',
  'robot_2',
  'search',
  'send',
  'stars',
  'trending_up',
  'tune',
  'warning',
] as const

const PUBLIC_MATERIAL_SYMBOLS =
  `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap&icon_names=${PUBLIC_MATERIAL_SYMBOL_NAMES.join(',')}`

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href={PUBLIC_MATERIAL_SYMBOLS} />
      <Navbar />
      {children}
      <Footer />
    </>
  )
}
