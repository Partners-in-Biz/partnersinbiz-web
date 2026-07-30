import {
  buildProjectCodeWorkspacePrompt,
  defaultMonorepoCodeRoots,
  normalizeProjectCodeRoots,
  projectAgentsTemplate,
} from '@/lib/projects/code-workspace'

describe('code-workspace helpers', () => {
  it('normalises code roots and drops unsafe paths', () => {
    expect(normalizeProjectCodeRoots([
      { path: 'frontend', label: 'UI' },
      'backend',
      '../secrets',
      '/abs',
      { path: 'frontend' },
    ])).toEqual([
      { path: 'frontend', label: 'UI' },
      { path: 'backend', label: 'backend' },
    ])
  })

  it('detects monorepo defaults from child names', () => {
    expect(defaultMonorepoCodeRoots(['frontend', 'backend', 'docs'])).toEqual([
      { path: 'frontend', label: 'Frontend' },
      { path: 'backend', label: 'Backend' },
    ])
  })

  it('builds a session prompt with company + multi-root guidance', () => {
    const prompt = buildProjectCodeWorkspacePrompt({
      projectName: 'Seller CRM',
      projectId: 'project-1',
      folderRelativePath: 'partners/Hunt and Gun/hunt-and-gun-seller-crm',
      projectFolderMode: 'registered',
      companyName: 'Hunt and Gun',
      companyId: 'company-1',
      codeRoots: [{ path: 'frontend', label: 'Frontend' }, { path: 'backend', label: 'Backend' }],
      sharedFolder: true,
    })
    expect(prompt).toContain('Hunt and Gun')
    expect(prompt).toContain('shared')
    expect(prompt).toContain('./frontend')
    expect(prompt).toContain('./backend')
    expect(prompt).toContain('Company root AGENTS.md')
  })

  it('renders an AGENTS template for a monorepo project', () => {
    const md = projectAgentsTemplate({
      projectName: 'Seller CRM',
      companyName: 'Hunt and Gun',
      companyWikiHint: 'Cowork/agents/hunt-and-gun',
      codeRoots: [{ path: 'frontend', label: 'Frontend' }, { path: 'backend', label: 'Backend' }],
    })
    expect(md).toContain('Hunt and Gun')
    expect(md).toContain('frontend/')
    expect(md).toContain('backend/')
    expect(md).toContain('Do **not** clone')
  })
})
