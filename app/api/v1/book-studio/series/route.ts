import { createBookStudioResourceHandlers } from '@/lib/book-studio/routes'

export const dynamic = 'force-dynamic'

const handlers = createBookStudioResourceHandlers('series')

export const GET = handlers.GET
export const POST = handlers.POST
