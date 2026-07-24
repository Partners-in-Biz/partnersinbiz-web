import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('VPS skill staging deployment', () => {
  const helper = readFileSync(resolve(process.cwd(), 'scripts/apply-vps-skill-staging.sh'), 'utf8')
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/sync-vps-skills.yml'), 'utf8')
  const sudoers = readFileSync(resolve(process.cwd(), 'ops/hermes-vps/pib-skill-sync.sudoers'), 'utf8')

  it('keeps the privileged installer bounded to an owned, symlink-free staging path', () => {
    expect(helper).toContain('^/srv/hermes-projects/pib-skill-staging/[0-9]+-[0-9]+$')
    expect(helper).toContain("stat -c '%U'")
    expect(helper).toContain('find -P "$staging" -type l')
    expect(helper).toContain('sudo -u hermes env HOME=/var/lib/hermes')
    expect(helper).toContain('PIB_SKILL_RESTART_STABILIZATION_SECONDS:-15')
    expect(helper).toContain('PIB_SKILL_RESTART_GAP_SECONDS:-2')
    expect(helper).toContain('PIB_SKILL_RESTART_DRAIN_SECONDS:-90')
    expect(helper).toContain('wait_for_quiet_port')
    expect(helper).toContain('wait_for_health')
    expect(helper).toContain('Rolling restart with drain')
    expect(helper).toContain('--property=NRestarts --value')
    expect(helper).toContain('restarted during the ${stabilization_seconds}s stabilization window')
    expect(helper).not.toContain('systemctl restart "${active_units[@]}"')
    expect(helper).not.toMatch(/(?:bash|sh|source|\.)\s+"?\$staging/)
  })

  it('stages outside the private Hermes home and invokes only the root-owned installer', () => {
    expect(workflow).toContain('/srv/hermes-projects/pib-skill-staging/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}')
    expect(workflow).toContain('local_helper_sha=$(sha256sum scripts/apply-vps-skill-staging.sh')
    expect(workflow).toContain('Root-owned VPS skill installer is not at the reviewed repository version')
    expect(workflow).toContain("sudo /usr/local/sbin/pib-apply-skill-staging '$staging'")
    expect(workflow).not.toContain(':/var/lib/hermes/')
    expect(sudoers).toContain('pib-apply-skill-staging /srv/hermes-projects/pib-skill-staging/*')
    expect(sudoers).not.toContain('NOPASSWD: ALL')
  })
})
