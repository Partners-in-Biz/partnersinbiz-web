import { buildCampaignEditorSavePayload } from '@/components/campaigns/EmailCampaignEditor'
import { DEFAULT_THEME, type EmailDocument } from '@/lib/email-builder/types'

describe('campaign editor save payload', () => {
  it('persists the sender policy currently represented in the editor', () => {
    const document: EmailDocument = { subject: 'Hello', preheader: '', theme: DEFAULT_THEME, blocks: [] }

    expect(buildCampaignEditorSavePayload({
      subject: 'Hello',
      previewText: 'Preview',
      emailDocument: document,
      senderPolicyId: 'policy-disabled',
    })).toEqual({
      subject: 'Hello',
      previewText: 'Preview',
      emailDocument: document,
      senderPolicyId: 'policy-disabled',
    })
  })
})
