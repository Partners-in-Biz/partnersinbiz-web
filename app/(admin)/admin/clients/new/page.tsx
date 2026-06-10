import { redirect } from 'next/navigation'

export default function ClientsNewRedirectPage() {
  redirect('/admin/organizations/new')
}
