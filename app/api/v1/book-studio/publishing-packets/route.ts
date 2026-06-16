import { createBookStudioResourceHandlers } from '@/lib/book-studio/routes'

export const dynamic = 'force-dynamic'

const handlers = createBookStudioResourceHandlers('publishing-packets')

export const GET = handlers.GET
export const POST = handlers.POST
