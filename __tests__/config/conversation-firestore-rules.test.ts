import fs from 'node:fs'
import path from 'node:path'

describe('conversation Firestore boundary', () => {
  const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8')

  it('keeps unredacted conversations and messages server-only', () => {
    expect(rules).toContain(`match /conversations/{convId} {
      allow read, write: if false;
    }`)
    expect(rules).toContain(`match /conversations/{convId}/messages/{msgId} {
      allow read, write: if false;
    }`)
  })

  it('does not trust mutable participant arrays or an unscoped admin role in client rules', () => {
    expect(rules).not.toContain('request.auth.uid in resource.data.participantUids')
    expect(rules).not.toContain('documents/conversations/$(convId)).data.participantUids')
  })
})
