import { conversationFolderAccentSeed, folderAccentColor, folderAccentStyle } from '@/lib/messages/folder-accent'

describe('folder accents', () => {
  it('returns a stable color for the same seed', () => {
    expect(folderAccentColor('company:sa-gun')).toBe(folderAccentColor('company:sa-gun'))
  })

  it('can assign different colors to different folders', () => {
    expect(folderAccentColor('company:sa-gun')).not.toBe(folderAccentColor('company:hunt-and-gun'))
  })

  it('prefers project identity over company identity for accent seeds', () => {
    expect(conversationFolderAccentSeed({
      workspaceContext: { companyId: 'company-1', projectId: 'project-9' },
    })).toBe('project:project-9')
  })

  it('falls back to company identity for Cowork folder chats', () => {
    expect(conversationFolderAccentSeed({
      workspaceContext: { companyId: 'company-1' },
    })).toBe('company:company-1')
  })

  it('exposes a CSS custom property for matching left-rail accents', () => {
    expect(folderAccentStyle('company:sa-gun')).toEqual({
      '--mx-folder-accent': folderAccentColor('company:sa-gun'),
    })
    expect(folderAccentStyle(null)).toEqual({})
  })
})
