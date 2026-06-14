import React from 'react'
import { render, screen } from '@testing-library/react'
import AdminLoopEnginePage from '@/app/(admin)/admin/loop-engine/page'
import { LOOP_REGISTRY } from '@/lib/loop-engine/registry'
import { OPERATOR_NAV, OPERATOR_NAV_TOPBAR } from '@/components/admin/navConfig'

jest.mock('next/link', () => {
  return function MockLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return <a href={href} {...props}>{children}</a>
  }
})

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({ docs: [] }),
          }),
        }),
      }),
    }),
  },
}))

describe('Admin loop engine page', () => {
  it('renders the loop registry, task readiness explainer, and approval gates', async () => {
    render(await AdminLoopEnginePage())

    expect(screen.getByRole('heading', { name: /loop engine/i })).toBeInTheDocument()
    expect(screen.getByText(/design loops that prompt agents/i)).toBeInTheDocument()
    expect(screen.getByText(/no-progress detection/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open admin projects/i })).toHaveAttribute('href', '/admin/projects')
    expect(screen.getByRole('link', { name: /open admin briefings/i })).toHaveAttribute('href', '/admin/briefings')

    expect(screen.getByRole('heading', { name: /full-loop execution layer/i })).toBeInTheDocument()
    expect(screen.getByText(/dry-run-first API/i)).toBeInTheDocument()
    expect(screen.getByText(/Progress signal/i)).toBeInTheDocument()
    expect(screen.getByText(/Needs human judgment/i)).toBeInTheDocument()
    expect(screen.getByText(/Last meaningful action/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Create internal lead-response task/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Draft lead response for approval/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/POST \/api\/v1\/admin\/loop-engine\/evaluate/i)).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /task eligibility explainer/i })).toBeInTheDocument()
    expect(screen.getAllByText(/agentStatus is awaiting-input, not pending/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Approval-sensitive task is not approved/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Approval gate id or explicit reviewer decision/i)).toBeInTheDocument()

    for (const loop of LOOP_REGISTRY) {
      expect(screen.getByRole('heading', { name: loop.name })).toBeInTheDocument()
      expect(screen.getByText(loop.whyItMatters)).toBeInTheDocument()
      expect(screen.getByText(loop.lastDecision)).toBeInTheDocument()
      expect(screen.getByText(loop.loopContract.stopCondition)).toBeInTheDocument()
      expect(screen.getByText(loop.loopContract.noProgressPolicy)).toBeInTheDocument()
      expect(screen.getByText(loop.positioning.buyerValue)).toBeInTheDocument()
    }
  })

  it('exposes Loop Engine in the admin sidebar and topbar navigation', () => {
    expect(OPERATOR_NAV).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Loop Engine', href: '/admin/loop-engine', icon: 'all_inclusive', group: 'work' }),
    ]))
    expect(OPERATOR_NAV_TOPBAR).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Loop Engine', href: '/admin/loop-engine', icon: 'all_inclusive' }),
    ]))
  })
})
