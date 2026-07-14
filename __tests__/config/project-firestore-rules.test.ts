import fs from 'node:fs'
import path from 'node:path'

describe('project Firestore boundary', () => {
  const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8')

  it('keeps unredacted projects and nested work records server-only', () => {
    expect(rules).toContain(`match /projects/{id} {
      // Project access is relationship-aware and public project responses redact
      // filesystem/runtime bindings. Keep every browser read/write behind the API.
      allow read, write: if false;
    }`)
    expect(rules).toContain(`match /projects/{projectId}/tasks/{taskId} {
      // Task access follows the parent project's current organisation links.
      allow read, write: if false;
    }`)
    expect(rules).toContain(`match /projects/{projectId}/tasks/{taskId}/comments/{commentId} {
      allow read, write: if false;
    }`)
  })

  it('does not grant project collection access from a mutable document field or global admin role', () => {
    const projectRuleStart = rules.indexOf('match /projects/{id}')
    const nextRuleStart = rules.indexOf('match /tasks/{id}', projectRuleStart)
    const projectRules = rules.slice(projectRuleStart, nextRuleStart)

    expect(projectRules).not.toContain('resource.data.clientId')
    expect(projectRules).not.toContain('isAdmin()')
  })

  it('keeps durable project setup operations and resume checkpoints server-only', () => {
    expect(rules).toContain(`match /project_setup_operations/{operationId} {
      allow read, write: if false;
    }`)
  })
})
