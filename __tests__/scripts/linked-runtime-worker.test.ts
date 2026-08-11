import fs from'node:fs';import os from'node:os';import path from'node:path';import{execFileSync}from'node:child_process';import{generateKeyPairSync}from'node:crypto';import{MappingRegistry}from'../../runtime-installers/runtime/bridge';import{executeJob,linkedRunPollDelay,LinkedRunProfileCapacity,pollForever}from'../../runtime-installers/runtime/worker'
import { DeviceApiClient } from '../../runtime-installers/runtime/client'
import { applyHeartbeatData,handleRotation,heartbeatForever,isRevokeAcknowledged,linkedRunMaxTotalConcurrency,linkedRuntimeHeartbeatBody,linkedRuntimePlatform,linkedRuntimeSyncClaimBody,nativeWorkspaceSyncSupported,recoverPendingRevocation,runRuntimeServicePollers,sanitizeIdentity } from '../../runtime-installers/runtime/cli'
import { callLocalHermes, isLocalHermesGatewayDrainingError, localHermesAgentHasActiveWork, localHermesRoutes, probeLocalHermes } from '../../runtime-installers/runtime/hermes'
import { pollAgentHostForever } from '../../runtime-installers/runtime/agent-host'
import { runtimeHeartbeatIsStale, superviseRuntimeService } from '../../runtime-installers/runtime/runtime-supervisor'
it('self-heals the managed Mac fleet without taking down healthy profiles or publishing false legacy health',()=>{
  const script=fs.readFileSync(path.join(process.cwd(),'scripts/start-local-runtime-fleet.sh'),'utf8')
  expect(script).toContain('read_shared_env_value AI_API_KEY')
  expect(script).toContain('read_shared_env_value PIB_AGENT_API_KEY')
  expect(script).toContain('authenticated PiB actions would fail')
  expect(script).toContain('export AI_API_KEY="$AI_API_KEY_VALUE"')
  expect(script).toContain('export PIB_API_BASE="${PIB_API_BASE_VALUE:-https://partnersinbiz.online/api/v1}"')
  expect(script).toContain("awk '!/^API_SERVER_(ENABLED|HOST|PORT|MODEL_NAME|KEY)=/'")
  expect(script).toContain("printf 'API_SERVER_MODEL_NAME=%s\\n' \"$agent_name\"")
  expect(script).toContain('mv "$profile_env_tmp" "$profile_env"')
  expect(script).toContain('wait_for_pid_exit')
  expect(script).toContain('fleet_deadline')
  expect(script).toContain('REGISTRATION_MAX_SECONDS')
  expect(script).toContain('register_pid=$!')
  expect(script).toContain('exec "$REPO/node_modules/.bin/tsx" scripts/register-local-agent-runtime.ts')
  expect(script).toContain('supervise_profile_at_index')
  expect(script).toContain('restarting only this profile')
  expect(script).toContain('FLEET_CONTROL_DIR')
  expect(script).toContain('consume_profile_control_request_at_index')
  expect(script).toContain('$FLEET_CONTROL_DIR/requests/${agent_name}.json')
  expect(script).toContain('profile_is_disabled')
  expect(script).toContain('restarting requested local Hermes profile $agent_name only')
  expect(script).toContain('deferring requested restart for busy local Hermes profile')
  expect(script).toContain('profile_has_active_work')
  expect(script).toContain('PROFILE_DRAIN_GRACE_SECONDS')
  expect(script).toContain('ensure_profile_port_free')
  expect(script).toContain('drain_stop_profile_pid')
  expect(script).toContain('missed health but still has active work')
  expect(script).toContain('mv "$request_path" "$claimed_path"')
  expect(script).toContain('skipping legacy public registration')
  expect(script).toContain('probe_reverse_tunnel_http')
  expect(script).toContain('kill_orphaned_reverse_tunnels')
  expect(script).toContain('wait_for_tunnel_http')
  expect(script).toContain('VPS reverse tunnel HTTP health ok')
  expect(script).toContain('REGISTRATION_RETRY_SECONDS')
  expect(script).not.toContain('exited; stopping fleet')
})
it('detects live Hermes API work before credential reloads', async () => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify({
    gateway_busy: false,
    active_agents: 0,
    readiness: { checks: { background_queues: { active_api_runs: 2 } } },
  }), { status: 200 })) as any
  await expect(localHermesAgentHasActiveWork('docs', {
    PIB_LOCAL_HERMES_ROUTES: JSON.stringify({ docs: { baseUrl: 'http://127.0.0.1:8771', apiKey: 'k' } }),
  }, fetcher)).resolves.toBe(true)
  expect(String(fetcher.mock.calls[0][0])).toContain('/health/detailed')
  const idleFetcher = jest.fn(async () => new Response(JSON.stringify({
    gateway_busy: false,
    active_agents: 0,
    readiness: { checks: { background_queues: { active_api_runs: 0 } } },
  }), { status: 200 })) as any
  await expect(localHermesAgentHasActiveWork('docs', {
    PIB_LOCAL_HERMES_ROUTES: JSON.stringify({ docs: { baseUrl: 'http://127.0.0.1:8771', apiKey: 'local-key' } }),
  }, idleFetcher)).resolves.toBe(false)
})
it('fails closed when the busy probe cannot be completed (no restart for unverifiable profiles)', async () => {
  const env = { PIB_LOCAL_HERMES_ROUTES: JSON.stringify({ docs: { baseUrl: 'http://127.0.0.1:8771', apiKey: 'local-key' } }) }
  const errorFetcher = jest.fn(async () => { throw new Error('tunnel flap: connection reset') }) as any
  await expect(localHermesAgentHasActiveWork('docs', env, errorFetcher)).resolves.toBe(true)
  const httpErrorFetcher = jest.fn(async () => new Response('gateway busy or dying', { status: 502 })) as any
  await expect(localHermesAgentHasActiveWork('docs', env, httpErrorFetcher)).resolves.toBe(true)
  const garbageFetcher = jest.fn(async () => new Response('<html>not json</html>', { status: 200 })) as any
  await expect(localHermesAgentHasActiveWork('docs', env, garbageFetcher)).resolves.toBe(true)
  await expect(localHermesAgentHasActiveWork('unknown-agent', env, jest.fn() as any)).resolves.toBe(true)
})
it.each([['darwin','macos'],['win32','windows'],['linux','linux']] as const)('reports Node platform %s as linked runtime platform %s',(nodePlatform,expected)=>{expect(linkedRuntimePlatform(nodePlatform)).toBe(expected)})
it('uses a safe 64-chat host ceiling even when the environment is malformed or too high',()=>{expect(linkedRunMaxTotalConcurrency('not-a-number')).toBe(64);expect(linkedRunMaxTotalConcurrency('120')).toBe(64);expect(linkedRunMaxTotalConcurrency('0')).toBe(64);expect(linkedRunMaxTotalConcurrency('9999')).toBe(64)})
it('attests sync protocol v1 and runs native sync polling beside normal execution polling',async()=>{expect(linkedRuntimeHeartbeatBody()).toEqual(expect.objectContaining({capabilities:['workspace.execute','workspace.sync'],syncProtocolVersion:1}));expect(linkedRuntimeSyncClaimBody()).toEqual(expect.objectContaining({syncProtocolVersion:1}));const calls:string[]=[];await runRuntimeServicePollers(async()=>{calls.push('runs')},async()=>{calls.push('sync')});expect(calls.sort()).toEqual(['runs','sync'])})
it('withholds workspace.sync attestation on platforms without race-free apply support',()=>{expect(nativeWorkspaceSyncSupported('darwin')).toBe(true);expect(nativeWorkspaceSyncSupported('linux')).toBe(true);expect(nativeWorkspaceSyncSupported('win32')).toBe(false);expect(linkedRuntimeHeartbeatBody('win32')).toEqual(expect.objectContaining({capabilities:['workspace.execute']}));expect(linkedRuntimeHeartbeatBody('win32')).not.toHaveProperty('syncProtocolVersion')})
it('withholds execution and reports degraded health when Hermes has no healthy local agent',()=>{expect(linkedRuntimeHeartbeatBody('darwin',{availableAgentIds:[],healthReason:'hermes_unavailable'})).toEqual(expect.objectContaining({health:'degraded',capabilities:['workspace.sync'],availableAgentIds:[],healthReason:'hermes_unavailable'}))})
it('reports hermes_binary_missing when the Hermes CLI is not installed',()=>{expect(linkedRuntimeHeartbeatBody('darwin',{availableAgentIds:[],healthReason:'hermes_binary_missing'})).toEqual(expect.objectContaining({health:'degraded',healthReason:'hermes_binary_missing',availableAgentIds:[]}))})
it('discovers the standard Hermes API credential without copying it into PiB state',()=>{const hermesHome=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-home-'));fs.writeFileSync(path.join(hermesHome,'.env'),'API_SERVER_KEY="discovered-key"\n');expect(localHermesRoutes({HERMES_HOME:hermesHome})).toEqual([{agentId:'pip',baseUrl:'http://127.0.0.1:8755',apiKey:'discovered-key'}])})
it('discovers independently configured named Hermes profiles on their loopback ports',()=>{const hermesHome=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-profiles-'));fs.mkdirSync(path.join(hermesHome,'profiles','sales'),{recursive:true});fs.mkdirSync(path.join(hermesHome,'profiles','unsafe profile'),{recursive:true});fs.writeFileSync(path.join(hermesHome,'.env'),'API_SERVER_PORT=8755\nAPI_SERVER_KEY=default-key\n');fs.writeFileSync(path.join(hermesHome,'profiles','sales','.env'),'API_SERVER_PORT=8761\nAPI_SERVER_KEY="sales-key"\n');fs.writeFileSync(path.join(hermesHome,'profiles','unsafe profile','.env'),'API_SERVER_PORT=8762\n');expect(localHermesRoutes({PIB_HERMES_HOME:hermesHome})).toEqual([{agentId:'pip',baseUrl:'http://127.0.0.1:8755',apiKey:'default-key'},{agentId:'sales',baseUrl:'http://127.0.0.1:8761',apiKey:'sales-key'}])})
it('prefers an explicitly named Pip profile over a same-named global gateway',()=>{const hermesHome=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-pip-profile-'));fs.mkdirSync(path.join(hermesHome,'profiles','pip'),{recursive:true});fs.writeFileSync(path.join(hermesHome,'.env'),'API_SERVER_PORT=8642\nAPI_SERVER_KEY=global-key\n');fs.writeFileSync(path.join(hermesHome,'profiles','pip','.env'),'API_SERVER_PORT=8755\nAPI_SERVER_KEY=managed-key\n');expect(localHermesRoutes({PIB_HERMES_HOME:hermesHome})).toEqual([{agentId:'pip',baseUrl:'http://127.0.0.1:8755',apiKey:'managed-key'}])})
it('probes and completes runs only on authenticated loopback Hermes agent routes',async()=>{const env={PIB_LOCAL_HERMES_ROUTES:JSON.stringify({pip:{baseUrl:'http://127.0.0.1:8755',apiKey:'local-key'},theo:'http://localhost:8756'}),PIB_LOCAL_HERMES_API_KEY:'fallback-key'},fetcher=jest.fn(async(url:any,init:any)=>{const target=String(url);return new Response(target.endsWith('/v1/health')?JSON.stringify({version:'0.18.2'}):target.endsWith('/v1/runs')?JSON.stringify({run_id:'run-local-1'}):JSON.stringify({status:'completed',output:'done'}),{status:200,headers:{'content-type':'application/json'}})}) as any;expect(localHermesRoutes(env)).toEqual([{agentId:'pip',baseUrl:'http://127.0.0.1:8755',apiKey:'local-key'},{agentId:'theo',baseUrl:'http://localhost:8756',apiKey:'fallback-key'}]);await expect(probeLocalHermes(env,fetcher)).resolves.toEqual({availableAgentIds:['pip','theo'],hermesVersion:'0.18.2'});await expect(callLocalHermes('pip',{prompt:'p',working_directory:'/tmp'},env,fetcher)).resolves.toBe('done');const startRequest=fetcher.mock.calls.find(([url]:[unknown])=>String(url).endsWith('/v1/runs'))?.[1];expect(startRequest?.headers.authorization).toBe('Bearer local-key');expect(startRequest?.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(String(startRequest?.body))).toEqual({input:'p',working_directory:'/tmp'});const pollRequest=fetcher.mock.calls.at(-1)?.[1];expect(pollRequest?.headers.authorization).toBe('Bearer local-key');expect(fetcher.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:8755/v1/runs/run-local-1');expect(()=>localHermesRoutes({PIB_LOCAL_HERMES:'https://remote.example'})).toThrow('loopback')})
it('does not apply a wall-clock timeout when local Hermes run timeout is zero',async()=>{let now=0,polls=0;const clock=jest.spyOn(Date,'now').mockImplementation(()=>now);const fetcher=jest.fn(async(url:any,init:any)=>{const target=String(url);if(target.endsWith('/v1/runs')&&init?.method==='POST')return new Response(JSON.stringify({run_id:'run-unlimited'}),{status:200});polls+=1;if(polls<3){now+=2_000_000;return new Response(JSON.stringify({status:'running'}),{status:200})}return new Response(JSON.stringify({status:'completed',output:'eventually done'}),{status:200})}) as any;try{await expect(callLocalHermes('pip',{prompt:'long work',working_directory:'/tmp'},{PIB_LOCAL_HERMES:'http://127.0.0.1:8755',PIB_LOCAL_HERMES_RUN_TIMEOUT_MS:'0'},fetcher,async()=>undefined)).resolves.toBe('eventually done');expect(polls).toBe(3)}finally{clock.mockRestore()}})
it('forwards linked-chat images to Hermes as native multimodal input',async()=>{const fetcher=jest.fn(async(url:any)=>new Response(String(url).endsWith('/v1/runs')?JSON.stringify({run_id:'run-image'}):JSON.stringify({status:'completed',output:'seen'}),{status:200,headers:{'content-type':'application/json'}})) as any;await expect(callLocalHermes('pip',{prompt:'describe',images:[{url:'https://storage.example/signed-image',contentType:'image/png'}],working_directory:'/tmp'},{PIB_LOCAL_HERMES:'http://127.0.0.1:8755'},fetcher)).resolves.toBe('seen');expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({input:[{role:'user',content:[{type:'text',text:'describe'},{type:'image_url',image_url:{url:'https://storage.example/signed-image'}}]}],working_directory:'/tmp'})})
it('forwards local Hermes SSE tool events while polling run status', async () => {
  const encoder = new TextEncoder()
  const eventStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"event":"tool.started","tool":"terminal"}\n\n'))
      controller.close()
    },
  })
  const fetcher = jest.fn(async (url: any) => {
    const target = String(url)
    if (target.endsWith('/v1/runs')) return new Response(JSON.stringify({ run_id: 'run-local-1' }), { status: 200 })
    if (target.endsWith('/events')) return new Response(eventStream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    return new Response(JSON.stringify({ status: 'completed', output: 'done' }), { status: 200 })
  }) as any
  const seen: unknown[] = []
  await expect(callLocalHermes(
    'pip',
    { prompt: 'p', working_directory: '/tmp' },
    { PIB_LOCAL_HERMES: 'http://127.0.0.1:8755' },
    fetcher,
    async () => undefined,
    async (events) => { seen.push(...events) },
  )).resolves.toBe('done')
  expect(seen).toEqual([expect.objectContaining({ event: 'tool.started', tool: 'terminal' })])
  expect(fetcher.mock.calls.some(([url]: [unknown]) => String(url).endsWith('/events'))).toBe(true)
})
it('keeps heartbeats independent from long-running execution and sync pollers',async()=>{let stopped=false;const beat=jest.fn(async()=>{}),wait=jest.fn(async()=>{stopped=true});await heartbeatForever(beat,()=>stopped,60_000,wait);expect(beat).toHaveBeenCalledTimes(1);expect(wait).toHaveBeenCalledWith(60_000)})
it('records heartbeat liveness before every signed heartbeat attempt',async()=>{let stopped=false;const attempts:number[]=[];await heartbeatForever(async()=>{stopped=true},()=>stopped,60_000,async()=>undefined,()=>{attempts.push(1)});expect(attempts).toEqual([1])})
it('reconnects a signed heartbeat promptly with capped backoff after a control-plane outage',async()=>{let stopped=false,attempts=0;const waits:number[]=[];await heartbeatForever(async()=>{attempts+=1;if(attempts<3)throw new Error('temporary network outage');stopped=true},()=>stopped,60_000,async ms=>{waits.push(ms)});expect(attempts).toBe(3);expect(waits).toEqual([1_000,2_000])})
it('yields after an agent-host job before claiming another delivery',async()=>{let stopped=false;const waits:number[]=[];await pollAgentHostForever(async()=>({jobId:'job-1'} as any),async()=>undefined,()=>stopped,async ms=>{waits.push(ms);stopped=true});expect(waits).toEqual([250])})
it('restarts a heartbeat-stale service worker without touching the Hermes fleet',async()=>{let stopped=false;const killed:string[]=[];let onExit:((code:number|null,signal:NodeJS.Signals|null)=>void)|undefined;const child={exitCode:null as number|null,once:jest.fn((_event:'exit',listener:(code:number|null,signal:NodeJS.Signals|null)=>void)=>{onExit=listener}),kill:jest.fn((signal?:NodeJS.Signals|number)=>{killed.push(String(signal));child.exitCode=1;onExit?.(1,typeof signal==='string'?signal:null);return true})};const spawnService=jest.fn(()=>child);await superviseRuntimeService({stateRoot:'/tmp/pib-runtime-test',executable:'/tmp/pib-runtime',stop:()=>stopped,spawnService,wait:async ms=>{if(ms===7)stopped=true},nowMs:()=>1_000,readLivenessMs:()=>0,removeLiveness:()=>undefined,log:()=>undefined,startupGraceMs:0,staleAfterMs:0,checkIntervalMs:1,terminateGraceMs:1,restartDelayMs:7});expect(spawnService).toHaveBeenCalledWith('/tmp/pib-runtime',['service'],expect.objectContaining({env:expect.objectContaining({PIB_RUNTIME_LIVENESS_FILE:'/tmp/pib-runtime-test/runtime-heartbeat.liveness'})}));expect(killed).toEqual(['SIGTERM'])})
it('does not classify a recent heartbeat as stale',()=>{expect(runtimeHeartbeatIsStale({childStartedAtMs:1_000,lastHeartbeatAttemptAtMs:9_500,nowMs:10_000,staleAfterMs:1_000,startupGraceMs:100})).toBe(false)})
it('keeps an idle execution claim inside the web acceptance window',()=>{expect(linkedRunPollDelay(30_000,()=>0.999)).toBeLessThanOrEqual(10_000)})
it('keeps claiming linked runs while another chat is still executing, up to the concurrency bound',async()=>{
  let stopped=false,claims=0,active=0,maxActive=0
  const releases:Array<()=>void>=[]
  const started:string[]=[]
  const jobs=[{jobId:'one'},{jobId:'two'},{jobId:'three'}] as any[]
  const claim=jest.fn(async()=>{
    const job=jobs[claims++]??null
    if(!job)stopped=true
    return job
  })
  const run=jest.fn(async(job:any)=>{
    active+=1
    maxActive=Math.max(maxActive,active)
    started.push(job.jobId)
    await new Promise<void>(resolve=>releases.push(resolve))
    active-=1
  })
  const polling=pollForever(claim,run,()=>stopped,{maxConcurrency:2})
  while(started.length<2)await new Promise(resolve=>setImmediate(resolve))
  expect(started).toEqual(['one','two'])
  expect(claim).toHaveBeenCalledTimes(2)
  releases.shift()?.()
  while(started.length<3)await new Promise(resolve=>setImmediate(resolve))
  expect(started).toEqual(['one','two','three'])
  expect(maxActive).toBe(2)
  releases.splice(0).forEach(release=>release())
  while(!stopped)await new Promise(resolve=>setImmediate(resolve))
  await polling
})
it('keeps an eleventh Pip chat queued while ten Theo chats run, without a ten-job device cap',async()=>{
  let stopped=false
  const started:string[]=[]
  const releases=new Map<string,()=>void>()
  const jobs=[
    ...Array.from({length:11},(_,index)=>({jobId:`pip-${index+1}`,agentId:'pip'})),
    ...Array.from({length:10},(_,index)=>({jobId:`theo-${index+1}`,agentId:'theo'})),
  ] as any[]
  const claim=jest.fn(async({saturatedAgentIds=[]}:{saturatedAgentIds?:string[]})=>{
    const next=jobs.findIndex(job=>!saturatedAgentIds.includes(job.agentId))
    return next<0?null:jobs.splice(next,1)[0]
  })
  const run=jest.fn(async(job:any)=>{
    started.push(job.jobId)
    await new Promise<void>(resolve=>releases.set(job.jobId,resolve))
  })
  const capacity=new LinkedRunProfileCapacity(10,64)
  capacity.setHealthyAgentIds(['pip','theo'])
  const polling=pollForever(claim,run,()=>stopped,{capacity})
  while(started.length<20)await new Promise(resolve=>setImmediate(resolve))
  expect(started.filter(jobId=>jobId.startsWith('pip-'))).toHaveLength(10)
  expect(started.filter(jobId=>jobId.startsWith('theo-'))).toHaveLength(10)
  expect(started).not.toContain('pip-11')
  expect(jobs).toEqual([{jobId:'pip-11',agentId:'pip'}])
  expect(claim).toHaveBeenCalledWith(expect.objectContaining({saturatedAgentIds:expect.arrayContaining(['pip'])}))
  expect(capacity.totalConcurrencyLimit()).toBe(20)
  stopped=true
  for(const release of releases.values())release()
  await polling
})
it('wakes after first heartbeat discovery so idle Hermes profiles are not stranded behind ten startup chats',async()=>{
  let stopped=false
  const started:string[]=[]
  const releases=new Map<string,()=>void>()
  const jobs=[
    ...Array.from({length:10},(_,index)=>({jobId:`pip-${index+1}`,agentId:'pip'})),
    ...Array.from({length:10},(_,index)=>({jobId:`theo-${index+1}`,agentId:'theo'})),
  ] as any[]
  const claim=jest.fn(async({saturatedAgentIds=[]}:{saturatedAgentIds?:string[]})=>{
    const next=jobs.findIndex(job=>!saturatedAgentIds.includes(job.agentId))
    return next<0?null:jobs.splice(next,1)[0]
  })
  const run=jest.fn(async(job:any)=>{
    started.push(job.jobId)
    await new Promise<void>(resolve=>releases.set(job.jobId,resolve))
  })
  const capacity=new LinkedRunProfileCapacity(10,64)
  const polling=pollForever(claim,run,()=>stopped,{capacity})
  while(started.length<10)await new Promise(resolve=>setImmediate(resolve))
  expect(started.every(jobId=>jobId.startsWith('pip-'))).toBe(true)
  capacity.setHealthyAgentIds(['pip','theo'])
  while(started.length<20)await new Promise(resolve=>setImmediate(resolve))
  expect(started.filter(jobId=>jobId.startsWith('theo-'))).toHaveLength(10)
  stopped=true
  for(const release of releases.values())release()
  await polling
})
it('keeps the runtime alive when an older server returns a locally saturated profile',async()=>{
  let stopped=false
  const started:string[]=[]
  const releases=new Map<string,()=>void>()
  const jobs=[
    ...Array.from({length:10},(_,index)=>({jobId:`pip-${index+1}`,agentId:'pip'})),
    {jobId:'pip-11',agentId:'pip'},
    {jobId:'theo-1',agentId:'theo'},
  ] as any[]
  const claim=jest.fn(async()=>jobs.shift()??null)
  const run=jest.fn(async(job:any)=>{
    started.push(job.jobId)
    await new Promise<void>(resolve=>releases.set(job.jobId,resolve))
  })
  const capacity=new LinkedRunProfileCapacity(10,64)
  capacity.setHealthyAgentIds(['pip','theo'])
  const polling=pollForever(claim,run,()=>stopped,{capacity})
  while(started.length<10)await new Promise(resolve=>setImmediate(resolve))
  releases.get('pip-1')?.()
  while(!started.includes('theo-1'))await new Promise(resolve=>setImmediate(resolve))
  expect(started).not.toContain('pip-11')
  expect(run).toHaveBeenCalledWith(expect.objectContaining({jobId:'theo-1'}))
  stopped=true
  for(const release of releases.values())release()
  await polling
})
it('surfaces concrete Hermes start and terminal failure details', async () => {
  const startFail = jest.fn(async () => new Response(JSON.stringify({ error: 'provider quota exhausted' }), { status: 503 })) as any
  await expect(callLocalHermes(
    'sales',
    { prompt: 'p', working_directory: '/tmp' },
    { PIB_LOCAL_HERMES_ROUTES: JSON.stringify({ sales: { baseUrl: 'http://127.0.0.1:8673', apiKey: 'k' } }) },
    startFail,
  )).rejects.toThrow(/sales.*503.*provider quota exhausted/i)
  expect(startFail).toHaveBeenCalledTimes(1)

  const terminalFail = jest.fn(async (url: any) => {
    const target = String(url)
    if (target.endsWith('/v1/runs')) return new Response(JSON.stringify({ run_id: 'run-fail' }), { status: 200 })
    return new Response(JSON.stringify({ status: 'failed', error: 'model refused tools' }), { status: 200 })
  }) as any
  await expect(callLocalHermes(
    'sales',
    { prompt: 'p', working_directory: '/tmp' },
    { PIB_LOCAL_HERMES_ROUTES: JSON.stringify({ sales: { baseUrl: 'http://127.0.0.1:8673', apiKey: 'k' } }) },
    terminalFail,
    async () => undefined,
  )).rejects.toThrow(/Local Hermes sales model refused tools/)
})

it('retries Hermes start while the gateway is draining, then succeeds', async () => {
  let starts = 0
  const waits: number[] = []
  const fetcher = jest.fn(async (url: any) => {
    const target = String(url)
    if (target.endsWith('/v1/runs') && !target.includes('/run-')) {
      starts += 1
      if (starts < 3) {
        return new Response(JSON.stringify({
          error: { message: 'Gateway is draining existing work; retry shortly.', code: 'gateway_draining' },
        }), { status: 503, headers: { 'Retry-After': '1' } })
      }
      return new Response(JSON.stringify({ run_id: 'run-after-drain' }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'completed', output: 'ok-after-drain' }), { status: 200 })
  }) as any
  await expect(callLocalHermes(
    'theo',
    { prompt: 'next turn', working_directory: '/tmp' },
    {
      PIB_LOCAL_HERMES_ROUTES: JSON.stringify({ theo: { baseUrl: 'http://127.0.0.1:8756', apiKey: 'k' } }),
      PIB_LOCAL_HERMES_START_RETRY_MS: '30000',
    },
    fetcher,
    async (ms) => { waits.push(ms) },
  )).resolves.toBe('ok-after-drain')
  expect(starts).toBe(3)
  expect(waits.length).toBe(2)
  expect(waits.every((ms) => ms >= 200 && ms <= 5_000)).toBe(true)
})

it('queues on Hermes 429 using Retry-After and reports the accepted local run id', async () => {
  let starts = 0
  const queued: string[] = []
  const started: string[] = []
  const fetcher = jest.fn(async (url: any) => {
    const target = String(url)
    if (target.endsWith('/v1/runs')) {
      starts += 1
      if (starts === 1) {
        return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), {
          status: 429,
          headers: { 'Retry-After': '1' },
        })
      }
      return new Response(JSON.stringify({ run_id: 'run-after-capacity' }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'completed', output: 'capacity-ok' }), { status: 200 })
  }) as any
  await expect(callLocalHermes(
    'pip',
    { prompt: 'queued turn', working_directory: '/tmp' },
    { PIB_LOCAL_HERMES: 'http://127.0.0.1:8755', PIB_LOCAL_HERMES_START_RETRY_MS: '30000' },
    fetcher,
    async () => undefined,
    {
      onQueued: async (reason) => { queued.push(reason) },
      onStarted: async (runId) => { started.push(runId) },
    },
  )).resolves.toBe('capacity-ok')
  expect(queued).toEqual(['agent_capacity'])
  expect(started).toEqual(['run-after-capacity'])
})

it('survives mid-poll gateway blips without failing the run', async () => {
  let polls = 0
  const queued: string[] = []
  const fetcher = jest.fn(async (url: any) => {
    const target = String(url)
    if (target.endsWith('/v1/runs') && !target.includes('/v1/runs/')) {
      return new Response(JSON.stringify({ run_id: 'run-mid-poll' }), { status: 200 })
    }
    if (target.endsWith('/v1/runs/run-mid-poll')) {
      polls += 1
      if (polls === 1) throw new Error('fetch failed')
      if (polls === 2) return new Response('bad gateway', { status: 502 })
      return new Response(JSON.stringify({ status: 'completed', output: 'poll-recovered' }), { status: 200 })
    }
    throw new Error(`unexpected ${target}`)
  }) as any
  await expect(callLocalHermes(
    'pip',
    { prompt: 'stay alive', working_directory: '/tmp' },
    { PIB_LOCAL_HERMES: 'http://127.0.0.1:8755' },
    fetcher,
    async () => undefined,
    { onQueued: async (reason) => { queued.push(reason) } },
  )).resolves.toBe('poll-recovered')
  expect(queued).toEqual(expect.arrayContaining(['runtime_restarting']))
  expect(polls).toBeGreaterThanOrEqual(3)
})

it('reattaches to an authenticated existing Hermes run and replaces only after a definitive 404', async () => {
  const restartReasons: string[] = []
  let restartProbe = 0
  const existingFetcher = jest.fn(async (url: any) => {
    const target = String(url)
    if (target.endsWith('/v1/runs/existing-run')) {
      restartProbe += 1
      if (restartProbe === 1) throw new Error('ECONNREFUSED')
      return new Response(JSON.stringify({ status: 'completed', output: 'reattached' }), { status: 200 })
    }
    throw new Error(`unexpected request ${target}`)
  }) as any
  await expect(callLocalHermes(
    'pip',
    { prompt: 'resume', working_directory: '/tmp' },
    { PIB_LOCAL_HERMES: 'http://127.0.0.1:8755' },
    existingFetcher,
    async () => undefined,
    {
      resumeRunId: 'existing-run',
      onQueued: async (reason) => { restartReasons.push(reason) },
    },
  )).resolves.toBe('reattached')
  expect(restartReasons).toEqual(['runtime_restarting'])
  expect(existingFetcher.mock.calls.filter(([url]: [unknown]) => String(url).endsWith('/v1/runs'))).toHaveLength(0)

  const missingFetcher = jest.fn(async (url: any, init?: RequestInit) => {
    const target = String(url)
    if (target.endsWith('/v1/runs/missing-run')) return new Response('', { status: 404 })
    if (target.endsWith('/v1/runs') && init?.method === 'POST') {
      return new Response(JSON.stringify({ run_id: 'replacement-run' }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'completed', output: 'replacement' }), { status: 200 })
  }) as any
  await expect(callLocalHermes(
    'pip',
    { prompt: 'replace', working_directory: '/tmp' },
    { PIB_LOCAL_HERMES: 'http://127.0.0.1:8755' },
    missingFetcher,
    async () => undefined,
    { resumeRunId: 'missing-run' },
  )).resolves.toBe('replacement')
  expect(missingFetcher.mock.calls.some(([url, init]: [unknown, RequestInit]) =>
    String(url).endsWith('/v1/runs') && init?.method === 'POST')).toBe(true)
})

it('does not hard-fail chat when drain retries are exhausted — leaves job for reclaim', async () => {
  expect(isLocalHermesGatewayDrainingError(
    new Error('Local Hermes theo refused to start (HTTP 503: {"error":{"message":"Gateway is draining existing work; retry shortly.","code":"gateway_draining"}})'),
  )).toBe(true)
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-drain-'))
  const root = path.join(d, 'root')
  fs.mkdirSync(root)
  const maps = new MappingRegistry(path.join(d, 'maps'))
  maps.map('m', root)
  const k = generateKeyPairSync('ed25519')
  const posts: any[] = []
  const post = jest.fn(async (p: string, b: any) => {
    posts.push([p, b])
    return new Response('', { status: 200 })
  })
  const hermes = jest.fn(async () => {
    throw new Error('Local Hermes theo refused to start (HTTP 503: Gateway is draining existing work; retry shortly. code=gateway_draining)')
  })
  await expect(executeJob(
    { jobId: 'j', requestId: 'r', prompt: 'p', workspaceId: 'w', projectId: 'p', mappingId: 'm', relativeFolder: '', attempt: 1, leaseToken: 'lease', agentId: 'theo' },
    { deviceId: 'd', credentialVersion: 1, privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    maps,
    post,
    hermes,
  )).rejects.toThrow(/gateway_draining|draining existing work/i)
  expect(posts.some(([p]) => String(p).endsWith('/complete'))).toBe(false)
  expect(posts[0]?.[1]?.receipt).toEqual(expect.objectContaining({ event: 'queued', outcome: 'queued' }))
  expect(posts[0]?.[1]?.receipt).not.toHaveProperty('queueReason')
})

it('retries once on browser-tool whole-run failure instead of completing failed', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-browser-'))
  const root = path.join(d, 'root')
  fs.mkdirSync(root)
  const maps = new MappingRegistry(path.join(d, 'maps'))
  maps.map('m', root)
  const k = generateKeyPairSync('ed25519')
  const posts: any[] = []
  const post = jest.fn(async (p: string, b: any) => {
    posts.push([p, b])
    return new Response('', { status: 200 })
  })
  let calls = 0
  const hermes = jest.fn(async (_body: any, helpers?: { resumeRunId?: string }) => {
    calls += 1
    if (calls === 1) {
      throw new Error('Local Hermes theo Unable to connect. Is the computer able to access the url?')
    }
    await helpers // keep helpers referenced
    return 'recovered after browser blip'
  })
  const result = await executeJob(
    { jobId: 'j2', requestId: 'r2', prompt: 'p', workspaceId: 'w', projectId: 'p', mappingId: 'm', relativeFolder: '', attempt: 1, leaseToken: 'lease', agentId: 'theo', localHermesRunId: 'old-run' },
    { deviceId: 'd', credentialVersion: 1, privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    maps,
    post,
    hermes,
  )
  expect(result.status).toBe('completed')
  expect(result.output).toContain('recovered')
  expect(hermes).toHaveBeenCalledTimes(2)
  expect(posts.some(([p, b]) => String(p).endsWith('/complete') && b?.outcome === 'completed')).toBe(true)
  expect(posts.some(([p, b]) => String(p).endsWith('/complete') && b?.outcome === 'failed')).toBe(false)
})

it('abandons for reclaim on runtime restart mid-run instead of completing failed', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-restart-'))
  const root = path.join(d, 'root')
  fs.mkdirSync(root)
  const maps = new MappingRegistry(path.join(d, 'maps'))
  maps.map('m', root)
  const k = generateKeyPairSync('ed25519')
  const posts: any[] = []
  const post = jest.fn(async (p: string, b: any) => {
    posts.push([p, b])
    return new Response('', { status: 200 })
  })
  const hermes = jest.fn(async () => {
    throw new Error('Local Hermes pip runtime restarting; reattachment retry window exhausted')
  })
  await expect(executeJob(
    { jobId: 'j3', requestId: 'r3', prompt: 'p', workspaceId: 'w', projectId: 'p', mappingId: 'm', relativeFolder: '', attempt: 1, leaseToken: 'lease', agentId: 'pip' },
    { deviceId: 'd', credentialVersion: 1, privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    maps,
    post,
    hermes,
  )).rejects.toThrow(/runtime restarting/i)
  expect(posts.some(([p]) => String(p).endsWith('/complete'))).toBe(false)
})

it('runs same-agent and different-agent jobs concurrently within the device cap', async () => {
  let stopped = false
  let claims = 0
  const releases = new Map<string, () => void>()
  const started: string[] = []
  const activeByAgent = new Map<string, number>()
  const maxByAgent = new Map<string, number>()
  let maxDeviceActive = 0
  let deviceActive = 0
  const jobs = [
    { jobId: 'theo-1', agentId: 'theo' },
    { jobId: 'theo-2', agentId: 'theo' },
    { jobId: 'pip-1', agentId: 'pip' },
  ] as any[]
  const claim = jest.fn(async () => {
    const job = jobs[claims++] ?? null
    if (!job && started.length >= 3) stopped = true
    return job
  })
  const run = jest.fn(async (job: any) => {
    deviceActive += 1
    maxDeviceActive = Math.max(maxDeviceActive, deviceActive)
    const agent = job.agentId
    activeByAgent.set(agent, (activeByAgent.get(agent) ?? 0) + 1)
    maxByAgent.set(agent, Math.max(maxByAgent.get(agent) ?? 0, activeByAgent.get(agent) ?? 0))
    started.push(job.jobId)
    await new Promise<void>((resolve) => { releases.set(job.jobId, resolve) })
    activeByAgent.set(agent, (activeByAgent.get(agent) ?? 1) - 1)
    deviceActive -= 1
  })
  const polling = pollForever(claim, run, () => stopped, { maxConcurrency: 4 })
  while (started.length < 3) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  expect(started).toEqual(expect.arrayContaining(['theo-1', 'theo-2', 'pip-1']))
  expect(maxByAgent.get('theo')).toBe(2)
  expect(maxDeviceActive).toBe(3)
  for (const release of releases.values()) release()
  while (!stopped) await new Promise((resolve) => setImmediate(resolve))
  await polling
})

it('propagates Hermes error text into the linked-run completion payload', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-err-'))
  const root = path.join(d, 'root')
  fs.mkdirSync(root)
  const maps = new MappingRegistry(path.join(d, 'maps'))
  maps.map('m', root)
  const k = generateKeyPairSync('ed25519')
  const posts: any[] = []
  const post = jest.fn(async (p: string, b: any) => {
    posts.push([p, b])
    return new Response('', { status: 200 })
  })
  const hermes = jest.fn(async () => {
    throw new Error('Local Hermes sales refused to start (HTTP 503: provider quota exhausted)')
  })
  const result = await executeJob(
    { jobId: 'j', requestId: 'r', prompt: 'p', workspaceId: 'w', projectId: 'p', mappingId: 'm', relativeFolder: '', attempt: 1, leaseToken: 'lease' },
    { deviceId: 'd', credentialVersion: 1, privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    maps,
    post,
    hermes,
  )
  expect(result.status).toBe('failed')
  expect(result.error).toMatch(/provider quota exhausted/)
  const complete = posts.find(([p]) => String(p).endsWith('/complete'))
  expect(complete?.[1].error).toMatch(/provider quota exhausted/)
})

it('runs a claimed job only in its contained mapping and retries an output-bound signed completion',async()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'worker-')),root=path.join(d,'root');fs.mkdirSync(root);const maps=new MappingRegistry(path.join(d,'maps'));maps.map('m',root);const k=generateKeyPairSync('ed25519'),calls:any[]=[];let completes=0;const post=jest.fn(async(p:string,b:any)=>{calls.push([p,b]);if(p.endsWith('/complete')&&completes++===0)return new Response('',{status:503});return new Response('',{status:200})});const hermes=jest.fn(async(b,helpers)=>{await helpers.onStarted('local-run-1');return{ok:true,cwd:b.working_directory}});const result=await executeJob({jobId:'j',requestId:'r',prompt:'p',workspaceId:'w',projectId:'p',mappingId:'m',relativeFolder:'',attempt:2,leaseToken:'lease-token-123'},{deviceId:'d',credentialVersion:2,privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()},maps,post,hermes);expect(hermes).toHaveBeenCalledWith(expect.objectContaining({working_directory:fs.realpathSync(root)}), expect.any(Object));expect(completes).toBe(2);expect(result.receipt).toEqual(expect.objectContaining({attempt:2,leaseToken:'lease-token-123',event:'completed',localHermesRunId:'local-run-1',outputBytes:Buffer.byteLength(result.output)}));expect(result.receipt.signature).toBeTruthy();expect(calls[0][1].receipt.event).toBe('queued');expect(calls[1][1].receipt.event).toBe('accepted')})

it('honours an absolute company Cowork sibling workingDirectory outside the org mapping root',async()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'worker-cowork-')),partners=path.join(d,'Partners in Biz'),hunt=path.join(d,'Hunt and Gun');fs.mkdirSync(partners);fs.mkdirSync(hunt);const maps=new MappingRegistry(path.join(d,'maps'));maps.map('m',partners);const k=generateKeyPairSync('ed25519');const post=jest.fn(async()=>new Response('',{status:200}));const hermes=jest.fn(async b=>({ok:true,cwd:b.working_directory}));await executeJob({jobId:'j',requestId:'r',prompt:'p',workspaceId:'w',projectId:'',mappingId:'m',relativeFolder:'.',workingDirectory:hunt,attempt:1,leaseToken:'lease'},{deviceId:'d',credentialVersion:1,privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()},maps,post,hermes);expect(hermes).toHaveBeenCalledWith(expect.objectContaining({working_directory:fs.realpathSync(hunt)}), expect.any(Object))})

it('isolates simultaneous Pip histories, working directories, and Hermes run identities by project',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'worker-isolation-')),rootA=path.join(d,'project-a'),rootB=path.join(d,'project-b')
  fs.mkdirSync(rootA);fs.mkdirSync(rootB)
  const maps=new MappingRegistry(path.join(d,'maps'));maps.map('map-a',rootA);maps.map('map-b',rootB)
  const k=generateKeyPairSync('ed25519'),outputs=new Map<string,string>()
  const post=jest.fn(async(p:string,b:any)=>{if(p.endsWith('/complete'))outputs.set(b.receipt.jobId,b.output);return new Response('',{status:200})})
  const hermes=jest.fn(async(b:any,helpers:any)=>{
    const runId=b.working_directory===fs.realpathSync(rootA)?'hermes-project-a':'hermes-project-b'
    await helpers.onStarted(runId)
    return `${runId}|${b.working_directory}|${b.prompt}`
  })
  const device={deviceId:'d',credentialVersion:1,privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()}
  await Promise.all([
    executeJob({jobId:'job-a',requestId:'r-a',prompt:'HISTORY_A_ONLY',workspaceId:'w',projectId:'a',mappingId:'map-a',relativeFolder:'.',attempt:1,leaseToken:'lease-a',agentId:'pip'},device,maps,post,hermes),
    executeJob({jobId:'job-b',requestId:'r-b',prompt:'HISTORY_B_ONLY',workspaceId:'w',projectId:'b',mappingId:'map-b',relativeFolder:'.',attempt:1,leaseToken:'lease-b',agentId:'pip'},device,maps,post,hermes),
  ])
  expect(outputs.get('job-a')).toBe(`hermes-project-a|${fs.realpathSync(rootA)}|HISTORY_A_ONLY`)
  expect(outputs.get('job-a')).not.toContain('HISTORY_B_ONLY')
  expect(outputs.get('job-b')).toBe(`hermes-project-b|${fs.realpathSync(rootB)}|HISTORY_B_ONLY`)
  expect(outputs.get('job-b')).not.toContain('HISTORY_A_ONLY')
})

it('creates a missing company Cowork sibling folder before resolving workingDirectory',async()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'worker-cowork-create-')),partners=path.join(d,'Partners in Biz'),missing=path.join(d,'Brand New Co');fs.mkdirSync(partners);const maps=new MappingRegistry(path.join(d,'maps'));maps.map('m',partners);const k=generateKeyPairSync('ed25519');const post=jest.fn(async()=>new Response('',{status:200}));const hermes=jest.fn(async b=>({ok:true,cwd:b.working_directory}));await executeJob({jobId:'j',requestId:'r',prompt:'p',workspaceId:'w',projectId:'',mappingId:'m',relativeFolder:'.',workingDirectory:missing,attempt:1,leaseToken:'lease'},{deviceId:'d',credentialVersion:1,privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()},maps,post,hermes);expect(fs.existsSync(path.join(missing,'AGENTS.md'))).toBe(true);expect(hermes).toHaveBeenCalledWith(expect.objectContaining({working_directory:fs.realpathSync(missing)}), expect.any(Object))})

it('signs every outbound queue request with a nonce and exact body',async()=>{const keys=generateKeyPairSync('ed25519'),seen:any[]=[];const fetcher=jest.fn(async(url:any,init:any)=>{seen.push([String(url),init]);return new Response(JSON.stringify({data:null}),{status:200,headers:{'content-type':'application/json'}})});const client=new DeviceApiClient('https://partnersinbiz.online',{deviceId:'device-1',credential:'credential-1',credentialVersion:3,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()},fetcher as any,()=>1700000000000,()=> 'nonce-123');await client.post('/api/v1/linked-computers/device-1/runs/claim',{runtimeVersion:'1.0.0'});const [,request]=seen[0],body=request.body,timestamp=request.headers['x-device-timestamp'],signature=request.headers['x-device-signature'];expect(request.headers['x-device-request-id']).toBe('nonce-123');expect(request.headers['x-device-credential']).toBe('credential-1');const payload=`POST\n/api/v1/linked-computers/device-1/runs/claim\n${timestamp}\nnonce-123\n${body}`;expect(require('node:crypto').verify(null,Buffer.from(payload),keys.publicKey,Buffer.from(signature,'base64url'))).toBe(true)})
it('bounds a stalled signed runtime request so heartbeat backoff can recover',async()=>{const keys=generateKeyPairSync('ed25519'),fetcher=jest.fn((_url:any,init:any)=>new Promise<Response>(()=>{}));const client=new DeviceApiClient('https://partnersinbiz.online',{deviceId:'device-timeout',credential:'credential-timeout',credentialVersion:3,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()},fetcher as any,Date.now,()=> 'nonce-timeout',1_000);await expect(client.post('/api/v1/linked-computers/device-timeout/heartbeat',{})).rejects.toThrow('PiB request timed out');expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)})
it('keeps the signed runtime deadline through a stalled response body',async()=>{const keys=generateKeyPairSync('ed25519'),fetcher=jest.fn(async()=>({ok:true,status:200,json:()=>new Promise<unknown>(()=>{})} as Response));const client=new DeviceApiClient('https://partnersinbiz.online',{deviceId:'device-body-timeout',credential:'credential-body-timeout',credentialVersion:3,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()},fetcher as any,Date.now,()=> 'nonce-body-timeout',1_000);await expect(client.postParsed('/api/v1/linked-computers/device-body-timeout/heartbeat',{},async response=>response.json())).rejects.toThrow('PiB request timed out');expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)})

it('persists mappings in a private registry and removes them cleanly',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'mapping-mode-')),root=path.join(d,'root'),file=path.join(d,'state','mappings.json');fs.mkdirSync(root);const maps=new MappingRegistry(file);maps.map('m',root);expect(fs.statSync(file).mode&0o777).toBe(0o600);expect(maps.status()).toEqual([{mappingId:'m',root:fs.realpathSync(root)}]);maps.unmap('m');expect(maps.status()).toEqual([])})

it('renews the signed lease while Hermes is still running and stops after completion',async()=>{jest.useFakeTimers();const d=fs.mkdtempSync(path.join(os.tmpdir(),'worker-renew-')),root=path.join(d,'root');fs.mkdirSync(root);const maps=new MappingRegistry(path.join(d,'maps'));maps.map('m',root);const k=generateKeyPairSync('ed25519'),events:string[]=[];let finish!:(v:string)=>void;const hermes=async(_b:any,helpers:any)=>{await helpers.onStarted('local-run-renew');return new Promise<string>(r=>{finish=r})};const post=jest.fn(async(_p:string,b:any)=>{events.push(b.receipt.event);return new Response('',{status:200})});const promise=executeJob({jobId:'j',requestId:'r',prompt:'p',workspaceId:'w',projectId:'p',mappingId:'m',relativeFolder:'',attempt:1,leaseToken:'lease'},{deviceId:'d',credentialVersion:1,privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()},maps,post,hermes,{progressIntervalMs:1000});await Promise.resolve();await jest.advanceTimersByTimeAsync(3100);expect(events.filter(x=>x==='progress').length).toBeGreaterThanOrEqual(3);finish('done');await promise;const count=events.length;await jest.advanceTimersByTimeAsync(5000);expect(events).toHaveLength(count);jest.useRealTimers()})

it('awaits an in-flight lease renewal before terminal completion',async()=>{jest.useFakeTimers();const d=fs.mkdtempSync(path.join(os.tmpdir(),'renew-race-')),root=path.join(d,'root');fs.mkdirSync(root);const maps=new MappingRegistry(path.join(d,'maps'));maps.map('m',root);const k=generateKeyPairSync('ed25519'),order:string[]=[];let releaseRenew!:(r:Response)=>void,finishHermes!:(v:string)=>void;const post=jest.fn(async(p:string,b:any)=>{if(b.receipt.event==='progress'){order.push('renew-start');return new Promise<Response>(r=>{releaseRenew=r})}if(p.endsWith('/complete'))order.push('complete');return new Response('',{status:200})});const hermes=async(_b:any,helpers:any)=>{await helpers.onStarted('local-run-race');return new Promise<string>(r=>{finishHermes=r})};const promise=executeJob({jobId:'j',requestId:'r',prompt:'p',workspaceId:'w',projectId:'p',mappingId:'m',relativeFolder:'',attempt:1,leaseToken:'lease'},{deviceId:'d',credentialVersion:1,privateKey:k.privateKey.export({type:'pkcs8',format:'pem'}).toString()},maps,post,hermes,{progressIntervalMs:1000});await Promise.resolve();await jest.advanceTimersByTimeAsync(1000);expect(order).toEqual(['renew-start']);finishHermes('done');await Promise.resolve();expect(order).toEqual(['renew-start']);releaseRenew(new Response('',{status:200}));await promise;expect(order).toEqual(['renew-start','complete']);jest.useRealTimers()})

it('applies a route-shaped one-time rotation without retaining transport tokens',async()=>{const current={deviceId:'d',credential:'old',credentialVersion:1,privateKey:'private',transportToken:'legacy'},next=applyHeartbeatData(current,{rotation:{credential:'new',credentialVersion:2,rotationDeliveryId:'delivery-1',transportToken:'discard'}});expect(next).toEqual({deviceId:'d',credential:'new',credentialVersion:2,privateKey:'private',pendingRotationDeliveryId:'delivery-1'});const fetcher=jest.fn(async()=>new Response('',{status:200})),keys=generateKeyPairSync('ed25519'),client=new DeviceApiClient('https://partnersinbiz.online',{...next,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()},fetcher as any);await client.post('/api/v1/linked-computers/d/runs/claim',{});expect((fetcher.mock.calls[0][1] as any).headers['x-device-credential-version']).toBe('2')})

it('persists and reads back rotation before acknowledging with the new credential',async()=>{const old={deviceId:'d',credential:'old',credentialVersion:1,privateKey:'private',transportToken:'legacy'},writes:any[]=[],acks:any[]=[];let stored:any=old;const persist=async(v:any)=>{stored=structuredClone(v);writes.push(stored)},read=async()=>stored,ack=async(v:any,id:string)=>{acks.push([v.credentialVersion,id])};const next=await handleRotation(old,{rotation:{credential:'new',credentialVersion:2,rotationDeliveryId:'delivery-1',transportToken:'discard'}},persist,read,ack);expect(writes[0]).toEqual(expect.objectContaining({credential:'new',credentialVersion:2,pendingRotationDeliveryId:'delivery-1'}));expect(writes[0]).not.toHaveProperty('transportToken');expect(acks).toEqual([[2,'delivery-1']]);expect(next).not.toHaveProperty('pendingRotationDeliveryId')})
it('never acknowledges a failed or torn secure write and retries a failed ack from durable state',async()=>{const old={deviceId:'d',credential:'old',credentialVersion:1,privateKey:'private'},rotation={rotation:{credential:'new',credentialVersion:2,rotationDeliveryId:'delivery-1'}},ack=jest.fn(async()=>{});await expect(handleRotation(old,rotation,async()=>{throw new Error('disk')},async()=>old,ack)).rejects.toThrow(/secure identity write/);await expect(handleRotation(old,rotation,async()=>{},async()=>old,ack)).rejects.toThrow(/secure identity write/);expect(ack).not.toHaveBeenCalled();let stored:any,attempts=0;const persist=async(v:any)=>{stored=structuredClone(v)},read=async()=>stored;await expect(handleRotation(old,rotation,persist,read,async()=>{attempts++;throw new Error('offline')})).rejects.toThrow(/acknowledgement/);expect(stored.pendingRotationDeliveryId).toBe('delivery-1');await expect(handleRotation(stored,{rotation:null},persist,read,async(v,id)=>{attempts++;expect(v.credentialVersion).toBe(2);expect(id).toBe('delivery-1')})).resolves.toEqual(expect.not.objectContaining({pendingRotationDeliveryId:expect.anything()}));expect(attempts).toBe(2)})
it('migrates legacy identities and repeated deliveries without persisting transport tokens',async()=>{expect(sanitizeIdentity({deviceId:'d',credential:'c',credentialVersion:2,privateKey:'p',transportToken:'secret'})).toEqual({deviceId:'d',credential:'c',credentialVersion:2,privateKey:'p'});let stored:any={deviceId:'d',credential:'new',credentialVersion:2,privateKey:'p',pendingRotationDeliveryId:'delivery-1'},acks=0;const result=await handleRotation(stored,{rotation:{credential:'new',credentialVersion:2,rotationDeliveryId:'delivery-1'}},async v=>{stored=v},async()=>stored,async()=>{acks++});expect(acks).toBe(1);expect(result.pendingRotationDeliveryId).toBeUndefined()})
it('revoke recovery retries only revoke, survives restart, and clears identity after ack',async()=>{const calls:string[]=[],cleared=jest.fn(),waits:number[]=[];let attempts=0;await recoverPendingRevocation(async()=>{calls.push('revoke');if(++attempts<3)throw new Error('offline')},async()=>{calls.push('clear');cleared()},async ms=>{waits.push(ms)},()=>false);expect(calls).toEqual(['revoke','revoke','revoke','clear']);expect(waits).toEqual([1000,2000]);expect(cleared).toHaveBeenCalled();expect(calls).not.toContain('claim');expect(calls).not.toContain('heartbeat')})

function gitRepositoryForTaskWorktree(): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-task-worktree-'))
  const origin = path.join(parent, 'origin.git')
  const root = path.join(parent, 'repo')
  execFileSync('git', ['init', '--bare', origin], { stdio: 'ignore' })
  fs.mkdirSync(root)
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git(['init', '-b', 'development'])
  git(['config', 'user.email', 'runtime-test@example.com'])
  git(['config', 'user.name', 'runtime test'])
  fs.writeFileSync(path.join(root, 'README.md'), 'runtime worktree test\n')
  git(['add', 'README.md'])
  git(['commit', '-m', 'seed'])
  git(['remote', 'add', 'origin', origin])
  git(['push', '-u', 'origin', 'development'])
  return root
}

it('runs a linked Kanban task from a task-scoped Git worktree rather than the shared mapping root', async () => {
  const root = gitRepositoryForTaskWorktree()
  const maps = new MappingRegistry(path.join(path.dirname(root), 'maps'))
  maps.map('m', root)
  const k = generateKeyPairSync('ed25519')
  const post = jest.fn(async () => new Response('', { status: 200 }))
  const hermes = jest.fn(async (body) => `cwd=${body.working_directory}`)
  const result = await executeJob(
    { jobId: 'linked-task-job', requestId: 'request', prompt: 'implement safely', workspaceId: 'w', projectId: 'p', mappingId: 'm', relativeFolder: '.', attempt: 1, leaseToken: 'lease', kanbanTaskId: 'kanban-safe-worktree' },
    { deviceId: 'device', credentialVersion: 1, privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    maps,
    post,
    hermes,
  )
  expect(result.status).toBe('completed')
  const cwd = String(hermes.mock.calls[0][0].working_directory)
  expect(cwd).toContain(`${path.sep}.pib-agent-worktrees${path.sep}`)
  expect(cwd).not.toBe(fs.realpathSync(root))
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('')
  fs.rmSync(path.dirname(root), { recursive: true, force: true })
})

it('preserves an authorised nested relativeFolder when routing a linked Kanban task into its isolated worktree', async () => {
  const root = gitRepositoryForTaskWorktree()
  const nested = path.join(root, 'packages', 'app')
  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'package.json'), '{"name":"nested-app"}\n')
  execFileSync('git', ['add', 'packages/app/package.json'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'add nested app'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['push', 'origin', 'development'], { cwd: root, stdio: 'ignore' })
  const maps = new MappingRegistry(path.join(path.dirname(root), 'maps'))
  maps.map('m', root)
  const k = generateKeyPairSync('ed25519')
  const hermes = jest.fn(async (body) => `cwd=${body.working_directory}`)
  const result = await executeJob(
    { jobId: 'nested-task-job', requestId: 'request', prompt: 'implement safely', workspaceId: 'w', projectId: 'p', mappingId: 'm', relativeFolder: 'packages/app', attempt: 1, leaseToken: 'lease', kanbanTaskId: 'kanban-nested-worktree' },
    { deviceId: 'device', credentialVersion: 1, privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    maps,
    async () => new Response('', { status: 200 }),
    hermes,
  )
  expect(result.status).toBe('completed')
  expect(String(hermes.mock.calls[0][0].working_directory)).toContain(`${path.sep}pib-task-kanban-nested-worktree${path.sep}packages${path.sep}app`)
  fs.rmSync(path.dirname(root), { recursive: true, force: true })
})

it('turns a dirty shared Git mapping into a terminal linked-run error without calling Hermes', async () => {
  const root = gitRepositoryForTaskWorktree()
  fs.writeFileSync(path.join(root, 'sibling-in-flight.txt'), 'do not touch\n')
  const maps = new MappingRegistry(path.join(path.dirname(root), 'maps'))
  maps.map('m', root)
  const k = generateKeyPairSync('ed25519')
  const posts: any[] = []
  const post = jest.fn(async (url, body) => { posts.push([url, body]); return new Response('', { status: 200 }) })
  const hermes = jest.fn(async () => 'must not run')
  const result = await executeJob(
    { jobId: 'dirty-task-job', requestId: 'request', prompt: 'implement safely', workspaceId: 'w', projectId: 'p', mappingId: 'm', relativeFolder: '.', attempt: 1, leaseToken: 'lease', kanbanTaskId: 'kanban-dirty-worktree' },
    { deviceId: 'device', credentialVersion: 1, privateKey: k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    maps,
    post,
    hermes,
  )
  expect(result).toEqual(expect.objectContaining({ status: 'failed', error: expect.stringContaining('shared_worktree_dirty') }))
  expect(hermes).not.toHaveBeenCalled()
  expect(fs.readFileSync(path.join(root, 'sibling-in-flight.txt'), 'utf8')).toBe('do not touch\n')
  expect(posts.some(([url, body]) => String(url).endsWith('/complete') && body.outcome === 'failed')).toBe(true)
  fs.rmSync(path.dirname(root), { recursive: true, force: true })
})
it.each([[200,{revoked:true,code:'device_revoked'},true],[200,{revoked:true,code:'already_revoked'},true],[401,{error:'signature'},false],[403,{revoked:true,code:'device_revoked'},false],[410,{revoked:true,code:'already_revoked'},false],[200,{revoked:true,code:'unknown'},false],[200,{status:'revoked'},false]])('accepts only exact successful revoke acknowledgement %#',async(status,body,expected)=>{await expect(isRevokeAcknowledged(new Response(JSON.stringify(body),{status}))).resolves.toBe(expected)})
it('keeps revoke pending on malformed acknowledgement JSON',async()=>{await expect(isRevokeAcknowledged(new Response('not-json',{status:200}))).resolves.toBe(false)})
