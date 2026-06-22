import { redirect } from 'next/navigation'

// Sprint list lives on the SEO overview page — redirect there.
export default function SprintsIndex() {
  redirect('/portal/seo')
}
