import { baseTemplate } from '@/lib/email/templates'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function partnerShareCommentEmail(input: {
  authorName: string
  authorOrgName: string
  recordTitle: string
  recordType: string
  body: string
  viewUrl: string
}): { subject: string; html: string } {
  const content = `
    <p style="color:rgba(255,255,255,0.6); font-size:14px; line-height:1.6; margin:0 0 16px 0;">
      <strong style="color:#FAFAFA;">${escapeHtml(input.authorName)}</strong> at
      ${escapeHtml(input.authorOrgName)} commented on the shared
      ${escapeHtml(input.recordType.replace('_', ' '))}
      <strong style="color:#FAFAFA;">${escapeHtml(input.recordTitle)}</strong>:
    </p>
    <div style="background:rgba(255,255,255,0.03); border-left:3px solid #F59E0B; padding:12px 16px; border-radius:4px; margin-bottom:16px;">
      <p style="color:rgba(255,255,255,0.8); font-size:13px; margin:0; white-space:pre-wrap;">${escapeHtml(input.body.slice(0, 600))}${input.body.length > 600 ? '…' : ''}</p>
    </div>
    <a href="${input.viewUrl}" style="display:inline-block; background:#F59E0B; color:#1A1A1A; padding:10px 20px; border-radius:8px; text-decoration:none; font-size:13px; font-weight:600;">
      View &amp; reply
    </a>
  `
  return {
    subject: `New comment on ${input.recordTitle}`,
    html: baseTemplate('Comment on a shared record', content),
  }
}

export function partnerInviteEmail(input: {
  inviterOrgName: string
  inviterName?: string
  recipientName?: string
  acceptUrl: string
  message?: string
  expiresAt?: string
}): { subject: string; html: string } {
  const orgName = escapeHtml(input.inviterOrgName)
  const greeting = input.recipientName ? `Hi ${escapeHtml(input.recipientName)},` : 'Hi,'
  const from = input.inviterName ? `${escapeHtml(input.inviterName)} at ${orgName}` : orgName
  const expires = input.expiresAt
    ? new Date(input.expiresAt).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })
    : ''

  const content = `
    <p style="color:rgba(255,255,255,0.6); font-size:14px; line-height:1.6; margin:0 0 16px 0;">
      ${greeting}
    </p>
    <p style="color:rgba(255,255,255,0.6); font-size:14px; line-height:1.6; margin:0 0 16px 0;">
      <strong style="color:#FAFAFA;">${from}</strong> would like to link workspaces with you on Partners in Biz.
      Once you accept, both businesses can see the shared relationship, work on projects together, and
      exchange documents — while each keeping its own private records.
    </p>
    ${input.message ? `<div style="background:rgba(255,255,255,0.03); border-left:3px solid #F59E0B; padding:12px 16px; border-radius:4px; margin-bottom:16px;">
      <p style="color:rgba(255,255,255,0.8); font-size:13px; margin:0;">"${escapeHtml(input.message)}"</p>
    </div>` : ''}
    <a href="${input.acceptUrl}" style="display:inline-block; background:#F59E0B; color:#1A1A1A; padding:10px 20px; border-radius:8px; text-decoration:none; font-size:13px; font-weight:600;">
      Review invitation
    </a>
    <p style="color:rgba(255,255,255,0.3); font-size:12px; line-height:1.6; margin:16px 0 0 0;">
      ${expires ? `This invitation expires on ${escapeHtml(expires)}. ` : ''}If you weren't expecting this, you can ignore this email.
    </p>
  `

  return {
    subject: `${input.inviterOrgName} invited you to connect on Partners in Biz`,
    html: baseTemplate('Partner invitation', content),
  }
}
