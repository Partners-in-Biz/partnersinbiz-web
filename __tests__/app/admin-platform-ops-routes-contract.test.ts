import * as fs from 'fs'
import * as path from 'path'

const repoRoot = process.cwd()

const PLATFORM_OPS_FILES = [
  'app/(admin)/admin/agents/AgentsBoardClient.tsx',
  'app/(admin)/admin/agents/[agentId]/page.tsx',
  'app/(admin)/admin/knowledge/page.tsx',
  'app/(admin)/admin/loop-engine/page.tsx',
  'app/(admin)/admin/mission-control/page.tsx',
  'app/(admin)/admin/skill-lab/page.tsx',
  'app/(admin)/admin/support/page.tsx',
  'components/agents/AgentDetailPanel.tsx',
  'components/agents/SkillTastingLabClient.tsx',
  'components/mission-control/PeetMissionControl.tsx',
  'components/support/AdminSupportInbox.tsx',
]

function read(file: string) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8')
}

describe('admin platform ops route contract', () => {
  it('keeps platform ops admin routes on admin/operator destinations instead of portal fallbacks', () => {
    const routeText = PLATFORM_OPS_FILES.map(read).join('\n')

    expect(routeText).not.toContain('/portal/projects')
    expect(routeText).not.toContain('/portal/briefings')
    expect(routeText).toContain('/admin/projects')
    expect(routeText).toContain('/admin/briefings')
  })

  it('labels platform ops surfaces as operator administration rather than client/member self-service', () => {
    const agents = read('app/(admin)/admin/agents/AgentsBoardClient.tsx')
    const support = read('components/support/AdminSupportInbox.tsx')
    const mission = read('components/mission-control/PeetMissionControl.tsx')
    const loop = read('app/(admin)/admin/loop-engine/page.tsx')
    const skillLab = read('components/agents/SkillTastingLabClient.tsx')

    expect(agents).toContain('Administer the specialist agents')
    expect(agents).not.toContain('serve your clients')

    expect(support).toContain('Support Operations')
    expect(support).toContain('operator reply')
    expect(support).not.toContain('Client support')
    expect(support).not.toContain('Reply to the client')

    expect(mission).toContain('operator command page')
    expect(mission).not.toContain('client risks')

    expect(loop).toContain('Operator-facing value')
    expect(loop).not.toContain('Buyer-facing value')

    expect(skillLab).toContain('Scoped organisation')
    expect(skillLab).not.toContain('<option value="client">Client organisation</option>')
  })

  it('keeps approval and runtime gates visible on agent and skill-lab operations', () => {
    const detail = read('components/agents/AgentDetailPanel.tsx')
    const skillLab = read('components/agents/SkillTastingLabClient.tsx')

    expect(detail).toContain('Only super admins can edit live agent configuration')
    expect(detail).toContain('Secrets remain redacted')
    expect(skillLab).toContain('no production deploy, paid spend, public publishing')
    expect(skillLab).toContain('secret/config changes')
  })
})
