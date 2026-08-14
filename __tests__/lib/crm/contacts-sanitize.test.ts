import { sanitizeContactForWrite } from '@/lib/crm/contacts'

describe('sanitizeContactForWrite profile links', () => {
  it('keeps website and social URLs while dropping unsafe extra links', () => {
    expect(sanitizeContactForWrite({
      orgId: 'attacker-org',
      website: '  ava.example  ',
      githubUrl: 'https://github.com/ava',
      youtubeUrl: 'javascript:alert(1)',
      otherLinks: [
        { label: '  Portfolio  ', url: '  ava.dev  ' },
        { label: 'Bad', url: 'javascript:alert(1)' },
      ],
    })).toEqual({
      website: 'ava.example',
      githubUrl: 'https://github.com/ava',
      youtubeUrl: '',
      otherLinks: [{ label: 'Portfolio', url: 'ava.dev' }],
    })
  })
})
