import {
  recordAddressedOrgIds,
  recordLinkedToUser,
  recordLinkedViaCrm,
  recordOperatorAddressed,
} from '@/lib/briefing/personal-scope'

describe('briefing personal-scope helpers', () => {
  describe('recordLinkedToUser', () => {
    it('matches direct assignment fields', () => {
      expect(recordLinkedToUser({ createdBy: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ ownerUid: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ assignedTo: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ accountManagerUid: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ linkedUserId: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ memberUid: 'user-1' }, 'user-1')).toBe(true)
    })

    it('matches ref-style assignment fields', () => {
      expect(recordLinkedToUser({ createdByRef: { uid: 'user-1' } }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ ownerRef: { uid: 'user-1' } }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ assignedToRef: { uid: 'user-1' } }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ memberRef: { uid: 'user-1' } }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ accountManagerRef: { uid: 'user-1' } }, 'user-1')).toBe(true)
    })

    it('matches share/allowed arrays', () => {
      expect(recordLinkedToUser({ allowedUserIds: ['user-1'] }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ assignedUserIds: ['user-1'] }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ sharedWithUserIds: ['user-1', 'user-2'] }, 'user-2')).toBe(true)
    })

    it('matches notification and comment recipients', () => {
      expect(recordLinkedToUser({ userId: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ userId: 'agent:maya' }, 'agent:maya')).toBe(true)
    })

    it('matches task human assignee fields', () => {
      expect(recordLinkedToUser({ assigneeId: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ assigneeIds: ['user-9', 'user-1'] }, 'user-1')).toBe(true)
    })

    it('matches approval participants and snapshot generators', () => {
      expect(recordLinkedToUser({ requestedBy: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ approvedBy: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ rejectedBy: 'user-1' }, 'user-1')).toBe(true)
      expect(recordLinkedToUser({ generatedBy: 'user-1' }, 'user-1')).toBe(true)
    })

    it('returns false when the record belongs to someone else', () => {
      expect(recordLinkedToUser({ createdBy: 'user-2' }, 'user-1')).toBe(false)
      expect(recordLinkedToUser({ ownerUid: 'user-2', assignedTo: 'user-3' }, 'user-1')).toBe(false)
      expect(recordLinkedToUser({ userId: 'user-2' }, 'user-1')).toBe(false)
      expect(recordLinkedToUser(null, 'user-1')).toBe(false)
      expect(recordLinkedToUser({ createdBy: 'user-1' }, '')).toBe(false)
    })
  })

  describe('recordLinkedViaCrm', () => {
    it('matches when the linked company is owned/assigned to the user', () => {
      const maps = {
        companies: new Map([['company-1', { id: 'company-1', ownerUid: 'user-1' }]]),
      }
      expect(recordLinkedViaCrm({ companyId: 'company-1' }, 'user-1', maps)).toBe(true)
    })

    it('matches when the linked contact is owned/assigned to the user', () => {
      const maps = {
        contacts: new Map([['contact-1', { id: 'contact-1', accountManagerUid: 'user-1' }]]),
      }
      expect(recordLinkedViaCrm({ contactId: 'contact-1' }, 'user-1', maps)).toBe(true)
    })

    it('matches when the contact links up to a company the user owns', () => {
      const maps = {
        companies: new Map([['company-1', { id: 'company-1', ownerUid: 'user-1' }]]),
        contacts: new Map([['contact-1', { id: 'contact-1', companyId: 'company-1' }]]),
      }
      expect(recordLinkedViaCrm({ contactId: 'contact-1' }, 'user-1', maps)).toBe(true)
    })

    it('returns false when maps are empty or the linked records belong to someone else', () => {
      expect(recordLinkedViaCrm({ companyId: 'company-1' }, 'user-1', {})).toBe(false)
      const maps = {
        companies: new Map([['company-1', { id: 'company-1', ownerUid: 'user-2' }]]),
      }
      expect(recordLinkedViaCrm({ companyId: 'company-1' }, 'user-1', maps)).toBe(false)
      expect(recordLinkedViaCrm(null, 'user-1', maps)).toBe(false)
    })
  })

  describe('recordOperatorAddressed', () => {
    it('flags pending/rejected approvals for the operator', () => {
      expect(recordOperatorAddressed('approval', { status: 'pending' })).toBe(true)
      expect(recordOperatorAddressed('approval', { status: 'rejected' })).toBe(true)
      expect(recordOperatorAddressed('approval', { status: 'approved' })).toBe(false)
    })

    it('flags blocked, awaiting-input, approval-required, and review-lane tasks', () => {
      expect(recordOperatorAddressed('task', { agentStatus: 'blocked' })).toBe(true)
      expect(recordOperatorAddressed('task', { agentStatus: 'awaiting-input' })).toBe(true)
      expect(recordOperatorAddressed('task', { requiresApproval: true })).toBe(true)
      expect(recordOperatorAddressed('task', { reviewStatus: 'changes-requested' })).toBe(true)
      expect(recordOperatorAddressed('task', { agentStatus: 'done', reviewStatus: 'pending', columnId: 'review' })).toBe(true)
      expect(recordOperatorAddressed('task', { agentStatus: 'done', columnId: 'done' })).toBe(false)
      expect(recordOperatorAddressed('task', { agentStatus: 'in-progress' })).toBe(false)
    })

    it('flags client documents pending approval or in review', () => {
      expect(recordOperatorAddressed('client-document', { requiresApproval: true })).toBe(true)
      expect(recordOperatorAddressed('client-document', { approvalStatus: 'pending' })).toBe(true)
      expect(recordOperatorAddressed('client-document', { status: 'in-review' })).toBe(true)
      expect(recordOperatorAddressed('client-document', { status: 'published' })).toBe(false)
    })

    it('flags social posts in review/approval lanes', () => {
      expect(recordOperatorAddressed('social-post', { status: 'qa_review' })).toBe(true)
      expect(recordOperatorAddressed('social-post', { status: 'client_review' })).toBe(true)
      expect(recordOperatorAddressed('social-post', { status: 'published' })).toBe(false)
    })

    it('flags open support tickets and social inbox items', () => {
      expect(recordOperatorAddressed('support-ticket', { status: 'new' })).toBe(true)
      expect(recordOperatorAddressed('support-ticket', { status: 'resolved' })).toBe(false)
      expect(recordOperatorAddressed('social-inbox', { status: 'open' })).toBe(true)
      expect(recordOperatorAddressed('social-inbox', { status: 'archived' })).toBe(false)
    })

    it('flags actionable invoices, quotes, orders, shipments, reports, campaigns', () => {
      expect(recordOperatorAddressed('invoice', { status: 'overdue' })).toBe(true)
      expect(recordOperatorAddressed('invoice', { status: 'paid' })).toBe(false)
      expect(recordOperatorAddressed('quote', { status: 'sent' })).toBe(true)
      expect(recordOperatorAddressed('quote', { status: 'declined' })).toBe(false)
      expect(recordOperatorAddressed('order', { status: 'draft' })).toBe(true)
      expect(recordOperatorAddressed('order', { status: 'completed' })).toBe(false)
      expect(recordOperatorAddressed('inventory-item', { status: 'out_of_stock' })).toBe(true)
      expect(recordOperatorAddressed('inventory-item', { status: 'in_stock' })).toBe(false)
      expect(recordOperatorAddressed('shipment', { status: 'failed' })).toBe(true)
      expect(recordOperatorAddressed('shipment', { status: 'delivered' })).toBe(false)
      expect(recordOperatorAddressed('report', { status: 'failed' })).toBe(true)
      expect(recordOperatorAddressed('report', { status: 'rendered' })).toBe(false)
      expect(recordOperatorAddressed('campaign', { status: 'draft' })).toBe(true)
      expect(recordOperatorAddressed('campaign', { status: 'active' })).toBe(false)
      expect(recordOperatorAddressed('broadcast', { status: 'paused' })).toBe(true)
      expect(recordOperatorAddressed('ad-campaign', { status: 'pending_approval' })).toBe(true)
    })

    it('matches the statuses the broadcast and ad-campaign adapters actually emit', () => {
      // broadcastAdapter emits a needs-peet "ready to send" card for drafts.
      expect(recordOperatorAddressed('broadcast', { status: 'draft' })).toBe(true)
      expect(recordOperatorAddressed('broadcast', { status: 'sent' })).toBe(false)
      // adCampaignAdapter only generates for PENDING_REVIEW + reviewState awaiting.
      expect(recordOperatorAddressed('ad-campaign', { status: 'PENDING_REVIEW', reviewState: 'awaiting' })).toBe(true)
      expect(recordOperatorAddressed('ad-campaign', { status: 'pending_review', reviewState: 'resolved' })).toBe(false)
      expect(recordOperatorAddressed('ad-campaign', { status: 'ACTIVE' })).toBe(false)
    })

    it('returns false for unknown types and null docs', () => {
      expect(recordOperatorAddressed('project', { status: 'active' })).toBe(false)
      expect(recordOperatorAddressed('task', null)).toBe(false)
    })
  })

  describe('recordAddressedOrgIds', () => {
    it('collects the owner org plus recipient/target/source orgs, deduplicated', () => {
      expect(recordAddressedOrgIds({ orgId: 'pib', sourceOrgId: 'pib', recipientOrgId: 'org-1' })).toEqual(['pib', 'org-1'])
      expect(recordAddressedOrgIds({ orgId: 'org-1', targetOrgId: ' org-2 ' })).toEqual(['org-1', 'org-2'])
      expect(recordAddressedOrgIds({ orgId: '' })).toEqual([])
      expect(recordAddressedOrgIds(null)).toEqual([])
    })
  })
})
