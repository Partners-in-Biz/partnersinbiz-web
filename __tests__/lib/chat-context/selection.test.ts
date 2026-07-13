import { selectActiveContext } from '@/lib/chat-context/selection'
import type { ChatContextReference } from '@/lib/chat-context/types'

const ref = (id: string): ChatContextReference => ({ kind: 'project', id })

describe('selectActiveContext', () => {
  it('uses explicit selection before every implicit source', () => {
    expect(selectActiveContext({
      explicit: ref('clicked'),
      conversation: ref('scoped'),
      composer: ref('composed'),
      attached: [ref('older'), ref('newer')],
    })?.id).toBe('clicked')
  })

  it('uses conversation, composer, then most recent attachment as fallbacks', () => {
    expect(selectActiveContext({ conversation: ref('scoped'), composer: ref('composed'), attached: [ref('newer')] })?.id).toBe('scoped')
    expect(selectActiveContext({ composer: ref('composed'), attached: [ref('newer')] })?.id).toBe('composed')
    expect(selectActiveContext({ attached: [ref('older'), ref('newer')] })?.id).toBe('newer')
  })

  it('ignores an explicit selection after that object is removed', () => {
    expect(selectActiveContext({ explicit: ref('removed'), conversation: ref('scoped'), available: [ref('scoped')] })?.id).toBe('scoped')
  })

  it('matches availability by kind and id, not id alone', () => {
    expect(selectActiveContext({
      explicit: { kind: 'project', id: 'shared' },
      conversation: { kind: 'company', id: 'shared' },
      available: [{ kind: 'company', id: 'shared' }],
    })).toEqual({ kind: 'company', id: 'shared' })
  })

  it('returns undefined for empty sources or when every candidate is unavailable', () => {
    expect(selectActiveContext({})).toBeUndefined()
    expect(selectActiveContext({ explicit: ref('removed'), attached: [ref('also-removed')], available: [] })).toBeUndefined()
  })
})
