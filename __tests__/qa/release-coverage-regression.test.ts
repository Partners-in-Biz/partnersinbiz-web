import { readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('cross-surface QA release coverage contracts', () => {
  it('keeps public onboarding protected from common intake regressions', () => {
    const route = source('app/api/v1/onboarding/route.ts')
    const form = source('app/(public)/start/[product]/AthleetOnboardingForm.tsx')
    const page = source('app/(public)/start/[product]/page.tsx')

    expect(route).toContain("ALLOWED_PRODUCTS = ['athleet-management']")
    expect(route).toContain('enforcePublicRateLimit')
    expect(route).toContain('onboarding_submit:${publicRequestIp(request)}')
    expect(route).toContain('onboarding_email:${publicRateLimitHash')
    expect(route).toContain('isValidEmail')
    expect(route).toContain("collection('onboarding_submissions')")
    expect(route).toContain("collection('contacts')")
    expect(route).toContain("source: 'onboarding-form'")
    expect(route).toContain("stage: 'onboarding'")
    expect(route).toContain('escapeHtml')
    expect(route).toContain('notification email failed')
    expect(route).toContain('return NextResponse.json({ id: submissionRef.id, contactId }, { status: 201 })')

    expect(form).toContain('const TOTAL_STEPS = 10')
    expect(form).toContain('Club Identity')
    expect(form).toContain('Brand & Design')
    expect(form).toContain('Coaches & Staff')
    expect(form).toContain('Programs & Divisions')
    expect(form).toContain('Club Stats')
    expect(form).toContain('Email Notifications')
    expect(form).toContain("product: 'athleet-management'")
    expect(form).toContain("fetch('/api/v1/onboarding'")
    expect(form).toContain('grid grid-cols-1 md:grid-cols-2')
    expect(form).toContain('md:p-12')
    expect(page).toContain('overflow-x-hidden')
    expect(page).toContain('grid grid-cols-1 lg:grid-cols-3')
  })

  it('keeps goal automation fail-closed and evaluated before sequence sends', () => {
    const goalsRoute = source('app/api/v1/sequences/[id]/goals/route.ts')
    const conditions = source('lib/sequences/conditions.ts')
    const cron = source('app/api/cron/sequences/route.ts')
    const editor = source('components/admin/sequences/GoalsEditor.tsx')

    expect(goalsRoute).toContain("withAuth('client'")
    expect(goalsRoute).toContain('resolveOrgScope')
    expect(goalsRoute).toContain('goals must be an array')
    expect(goalsRoute).toContain('Each goal must have an id')
    expect(goalsRoute).toContain('Each goal must have a label')
    expect(goalsRoute).toContain('Each goal must have a condition.kind')
    expect(goalsRoute).toContain('updatedAt: FieldValue.serverTimestamp()')

    expect(conditions).toContain('export async function findHitGoal')
    expect(conditions).toContain('if (!Array.isArray(goals) || goals.length === 0) return null')
    expect(conditions).toContain('if (seen.has(goalId)) return false')
    expect(conditions).toContain('return evaluateCondition(goal.condition')
    expect(cron).toContain('const preHit = await findHitGoal(goals, evalCtx)')
    expect(cron).toContain("exitReason: 'goal-hit'")
    expect(cron).toContain('metadata: { goalId: goal.id')

    expect(editor).toContain('+ Add exit goal')
    expect(editor).toContain('No exit goals')
    expect(editor).toContain('Exit reason label')
  })

  it('keeps dashboards, notifications, privacy controls, mobile, accessibility, and side-effect gates represented in regression coverage', () => {
    const missionControl = source('app/(admin)/admin/dashboard/page.tsx')
    const missionControlTest = source('__tests__/app/admin-mission-control-dashboard.test.tsx')
    const portalDashboardTest = source('__tests__/app/portal-dashboard-crm-widget.test.tsx')
    const notificationsRoute = source('app/api/v1/notifications/route.ts')
    const notificationsSettings = source('app/(portal)/portal/settings/notifications/page.tsx')
    const privacyPolicy = source('app/(public)/privacy-policy/page.tsx')
    const firstRunRoute = source('app/api/v1/portal/first-run/route.ts')
    const firstRunTest = source('__tests__/api/portal-first-run.test.ts')
    const portalLayout = source('app/(portal)/PortalLayoutClient.tsx')
    const dataExportTest = source('__tests__/api/portal-data-export.test.ts')
    const responsiveTest = source('__tests__/responsive-overflow.test.ts')

    expect(missionControl).toContain('Derived operator insight dashboards')
    expect(missionControl).toContain('Goal progress dashboard')
    expect(missionControl).toContain('Energy and mood trends')
    expect(missionControl).toContain('Next best actions dashboard')
    expect(missionControlTest).toContain('renders explainable operator insight dashboards')
    expect(portalDashboardTest).toContain('CRM')
    expect(notificationsRoute).toContain('export const GET')
    expect(notificationsSettings).toContain('Notification command center')
    expect(notificationsSettings).toContain('PushNotificationsToggle')
    expect(privacyPolicy).toContain('Privacy Policy')
    expect(firstRunRoute).toContain('consentToStore')
    expect(firstRunRoute).toContain('Storage consent is required before saving first-run answers')
    expect(firstRunTest).toContain('requires explicit storage consent')
    expect(portalLayout).toContain('/privacy-policy')
    expect(dataExportTest).toContain('portal/data-export')
    expect(dataExportTest).toContain('orgId=lumen-org')
    expect(responsiveTest).toContain('overflow')

    expect(portalLayout).toMatch(/aria-label|aria-current/)
    expect(missionControl).toContain('aria-label="Derived operator insight dashboards"')
  })

  it('documents the current repository gap for first-class habits, reflections, and AI-coach app modules', () => {
    const routeInventory = source('app/sitemap.ts') + source('app/(public)/work/[slug]/page.tsx')

    expect(routeInventory).toContain('AI-assisted practice')
    expect(routeInventory).toContain('reading history')
    expect(routeInventory).toContain('onboarding')

    // These are currently represented as marketing/case-study language, not as
    // first-class PiB web app routes. This passing contract makes the gap visible
    // in QA evidence without inventing non-existent runtime coverage.
    expect(routeInventory).not.toMatch(/\/habits|\/reflections|\/ai-coach/)
  })
})
