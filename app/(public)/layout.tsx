import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

const PUBLIC_MATERIAL_SYMBOLS =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap&icon_names=add,arrow_back,arrow_forward,arrow_outward,auto_awesome,autorenew,bolt,calendar_month,chat,check,check_circle,dashboard,delete,event,event_available,expand_more,mail,phone_iphone,public,send,stars,trending_up,tune'

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
