import fs from 'node:fs'
import path from 'node:path'

// Guards the Firestore rules file against reintroducing global role=admin
// client-SDK grants on CRM collections (P0 cross-org hardening).
describe('CRM Firestore rules boundary', () => {
  const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8')

  function block(collection: string): string {
    const start = rules.indexOf(`match /${collection}/{id}`)
    expect(start).toBeGreaterThanOrEqual(0)
    const next = rules.indexOf('match /', start + 1)
    return rules.slice(start, next === -1 ? rules.length : next)
  }

  it.each(['contacts', 'deals', 'activities'])('%s denies direct client access', (collection) => {
    expect(block(collection)).toContain('allow read, write: if false;')
    expect(block(collection)).not.toContain('isAdmin()')
  })

  it.each(['emails', 'sequences', 'sequence_enrollments', 'campaigns', 'recurring_schedules', 'ai_action_log'])(
    '%s (adjacent direct-read CRM collection) denies direct client access',
    (collection) => {
      expect(block(collection)).toContain('allow read, write: if false;')
      expect(block(collection)).not.toContain('isAdmin()')
    },
  )

  it.each(['comments', 'notifications', 'uploads', 'calendar_events', 'time_entries', 'expenses', 'forms', 'form_submissions', 'outbound_webhooks', 'webhook_deliveries'])(
    '%s (same global-role bypass pattern) denies direct client access',
    (collection) => {
      expect(block(collection)).toContain('allow read, write: if false;')
      expect(block(collection)).not.toContain('isAdmin()')
    },
  )

  it('keeps the org-scoped live-updates surface on active membership only', () => {
    expect(rules).toContain(`      match /crm_live_updates/{entity} {
        allow read: if isOrgMember(orgId);
        allow write: if false;
      }`)
    // The membership predicate must not fall back to the global admin role.
    const orgMemberFn = rules.slice(rules.indexOf('function isOrgMember'), rules.indexOf('// ── Users'))
    expect(orgMemberFn).not.toContain('isAdmin()')
    expect(orgMemberFn).toContain('disabled')
    expect(orgMemberFn).toContain('deleted')
  })
})
