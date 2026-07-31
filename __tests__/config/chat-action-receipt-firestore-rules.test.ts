import fs from 'fs'
import path from 'path'

describe('chat action receipt Firestore rules', () => {
  it('keeps durable action receipts behind the authenticated conversation API', () => {
    const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match\s+\/chat_action_receipts\/\{id\}\s*\{\s*allow read, write:\s*if false;\s*\}/,
    )
  })
})
