#!/usr/bin/env node
import { randomUUID, sign } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { superviseRuntimeService, touchRuntimeHeartbeatLiveness } from './runtime-supervisor'
import { createPairingIdentity, pairingPayload, redactLog, revokeAndCleanup } from './core'
import type{JSONValue}from'./core'
import { MappingRegistry } from './bridge'
import { DeviceApiClient, type DeviceIdentity } from './client'
import { executeJob, LINKED_RUN_DEFAULT_MAX_TOTAL_CONCURRENCY, LinkedRunProfileCapacity, pollForever, type Job, type LinkedRunClaimCapacity } from './worker'
import { callLocalHermes, listLocalHermesModels, probeLocalHermes, type LocalHermesProbe } from './hermes'
import { hermesVersionBelowMin, isRuntimeIdleForHermesUpdate, readHermesUpdateHealthReason, scheduleHermesUpdateAfterHeartbeat } from './hermes-update'
import {
  executeWorkbenchJob,
  pollWorkbenchForever,
  type WorkbenchRuntimeJob,
} from './workbench'
import {
  linkedRuntimeWorkbenchSessionsClaimBody,
  pollWorkbenchSessionsForever,
  runWorkbenchSessionClaim,
  type WorkbenchSessionClaim,
} from './workbench-sessions'
import {
  linkedRuntimeWorkbenchTunnelsClaimBody,
  pollWorkbenchTunnelsForever,
  runWorkbenchTunnelClaim,
  type WorkbenchTunnelClaim,
} from './workbench-tunnel'
import {
  linkedRuntimeWorkbenchBrowserClaimBody,
  pollWorkbenchBrowserForever,
  runWorkbenchBrowserClaim,
  type WorkbenchBrowserClaim,
} from './workbench-browser'
import {
  pollWorkbenchDesktopForever,
  probeDesktopCapabilities,
  runDesktopClaim,
  type DesktopClaim,
} from './workbench-desktop'
import {
  executeAgentHostJob,
  linkedRuntimeAgentHostClaimBody,
  pollAgentHostForever,
  type AgentHostRuntimeJob,
} from './agent-host'
import { pollRelayForever } from './bot-relay-courier'
import {
  DurableSyncSpool,
  executeWorkspaceSyncJob,
  nativeWorkspaceSyncSupported as workspaceSyncNativeSupported,
  pollWorkspaceSyncForever,
  type WorkspaceSyncRuntimeJob,
} from './workspace-sync'

const api=process.env.PIB_API_BASE||'https://partnersinbiz.online'
const runtimeVersion=process.env.PIB_RUNTIME_VERSION||'1.1.30'
const stateRoot=process.env.PIB_RUNTIME_STATE_DIR||path.join(os.homedir(),'.partnersinbiz')
const revocationMarker=path.join(stateRoot,'revocation-pending.json')
const maps=new MappingRegistry(path.join(stateRoot,'mappings.json'))
const syncSpool=new DurableSyncSpool(path.join(stateRoot,'workspace-sync-receipts.json'))
export function linkedRunMaxTotalConcurrency(value=process.env.PIB_LINKED_RUN_MAX_TOTAL_CONCURRENCY):number{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?Math.min(Math.floor(parsed),LINKED_RUN_DEFAULT_MAX_TOTAL_CONCURRENCY):LINKED_RUN_DEFAULT_MAX_TOTAL_CONCURRENCY}
const linkedRunCapacity=new LinkedRunProfileCapacity(undefined,linkedRunMaxTotalConcurrency())
const helper=process.env.PIB_CREDENTIAL_HELPER||path.join(path.dirname(process.execPath),process.platform==='win32'?'pib-credential-helper.exe':'pib-credential-helper')
type RuntimeIdentity=DeviceIdentity&{pendingRotationDeliveryId?:string;transportToken?:string;[key:string]:JSONValue|undefined}
type Rotation={credential:string;credentialVersion:number;rotationDeliveryId:string}
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid PiB response');return value as Record<string,unknown>}
const store={async put(name:string,value:string){const {spawnSync}=await import('node:child_process');const r=spawnSync(helper,['put',name],{input:value,stdio:['pipe','ignore','pipe']});if(r.status)throw new Error('secure credential write failed')},async get(name:string){const {execFileSync}=await import('node:child_process');return execFileSync(helper,['get',name],{encoding:'utf8'}).trim()},async clear(){const {execFileSync}=await import('node:child_process');try{execFileSync(helper,['clear'])}catch{}}}

async function promptSecret(label:string){
 if(!process.stdin.isTTY)return new Promise<string>(r=>process.stdin.once('data',d=>r(String(d).trim())))
 process.stderr.write(label);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8')
 return new Promise<string>((resolve,reject)=>{let value='';const done=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');process.stdin.removeListener('data',onData);resolve(value)};const onData=(c:string)=>{if(c==='\u0003'){process.stdin.setRawMode(false);reject(new Error('cancelled'))}else if(c==='\r'||c==='\n')done();else if(c==='\u007f')value=value.slice(0,-1);else if(c>=' ')value+=c};process.stdin.on('data',onData)})
}
export function sanitizeIdentity<T extends RuntimeIdentity>(value:T):T{if(!Object.prototype.hasOwnProperty.call(value,'transportToken'))return value;const next={...value};delete next.transportToken;return next}
export function linkedRuntimePlatform(platform:string):'macos'|'windows'|'linux'{if(platform==='darwin')return'macos';if(platform==='win32')return'windows';if(platform==='linux')return'linux';throw new Error('unsupported runtime platform')}
async function persistIdentity(value:RuntimeIdentity){await store.put('identity',JSON.stringify(sanitizeIdentity(value)))}
async function identity():Promise<RuntimeIdentity>{const raw=record(JSON.parse(await store.get('identity'))) as RuntimeIdentity;if(typeof raw.deviceId!=='string'||typeof raw.credential!=='string'||!Number.isInteger(raw.credentialVersion)||typeof raw.privateKey!=='string')throw new Error('secure identity invalid');const clean=sanitizeIdentity(raw);if(clean!==raw)await persistIdentity(clean);return clean}
async function client(){return new DeviceApiClient(api,await identity())}
async function post(path:string,body:unknown){return (await client()).post(path,body)}
async function jsonData(response:Response):Promise<unknown>{if(!response.ok)throw new Error(`PiB request rejected (${response.status})`);return record(await response.json()).data}
function rotationFrom(data:unknown):Rotation|null{if(!data||typeof data!=='object')return null;const candidate=(data as Record<string,unknown>).rotation;if(!candidate||typeof candidate!=='object')return null;const r=candidate as Record<string,unknown>;return typeof r.credential==='string'&&Number.isInteger(r.credentialVersion)&&typeof r.rotationDeliveryId==='string'?r as unknown as Rotation:null}
function ownerUserIdFrom(data:unknown):string{if(!data||typeof data!=='object')return'';const value=(data as Record<string,unknown>).ownerUserId;return typeof value==='string'&&value.trim()?value.trim():''}
export function applyHeartbeatData<T extends RuntimeIdentity>(current:T,data:unknown):T{const clean=sanitizeIdentity(current);const ownerUserId=ownerUserIdFrom(data);const withOwner=ownerUserId&&clean.ownerUserId!==ownerUserId?{...clean,ownerUserId}:clean;const rotation=rotationFrom(data);if(!rotation)return withOwner;if(rotation.credentialVersion<clean.credentialVersion)return withOwner;if(rotation.credentialVersion===clean.credentialVersion&&rotation.credential!==clean.credential)return withOwner;return{...withOwner,credential:rotation.credential,credentialVersion:rotation.credentialVersion,pendingRotationDeliveryId:rotation.rotationDeliveryId}}
export async function handleRotation<T extends RuntimeIdentity>(current:T,data:unknown,persist:(value:T)=>Promise<void>,read:()=>Promise<T>,ack:(value:T,deliveryId:string)=>Promise<void>):Promise<T>{let durable=applyHeartbeatData(current,data);const deliveryId=durable.pendingRotationDeliveryId;if(durable!==current){try{await persist(durable);const check=sanitizeIdentity(await read());if(check.credential!==durable.credential||check.credentialVersion!==durable.credentialVersion||check.pendingRotationDeliveryId!==deliveryId)throw new Error()}catch{throw new Error('secure identity write failed')}}if(!deliveryId)return durable;try{await ack(durable,deliveryId)}catch{throw new Error('rotation acknowledgement failed')}const acknowledged={...durable};delete acknowledged.pendingRotationDeliveryId;try{await persist(acknowledged as T);durable=sanitizeIdentity(await read())}catch{throw new Error('secure identity write failed')}return durable}

function optionalOption(args:string[],name:string):string|undefined{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1])throw new Error(`${name} is required`);return args[i+1]}
function releaseChannelFrom(args:string[]):'internal'|'stable'{const value=optionalOption(args,'--channel')??'stable';if(value!=='internal'&&value!=='stable')throw new Error('invalid release channel');return value}
function agentIdsFrom(args:string[]):string[]{const raw=optionalOption(args,'--agents')??'pip';const ids=raw.split(',').map(value=>value.trim()).filter(Boolean);if(ids.length===0||ids.length>6||ids.some(id=>!/^[a-z][a-z0-9._-]{1,39}$/.test(id)))throw new Error('invalid agents');return ids}
async function pair(challengeId:string,releaseChannel:'internal'|'stable'='stable',agentIds:string[]=['pip']){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(challengeId||''))throw new Error('invalid challenge identifier')
 const {resolveHermesBinary}=await import('./hermes-profile-lifecycle')
 if(!resolveHermesBinary())throw new Error('Hermes must be installed on this computer before it can be linked')
 const code=await promptSecret('One-time pairing code: '),deviceId=randomUUID(),keys=createPairingIdentity()
 const proof=sign(null,Buffer.from(pairingPayload(challengeId,code,deviceId,keys.publicKey)),keys.privateKey).toString('base64url')
 const response=await fetch(`${api}/api/v1/linked-computers/pairing/exchange`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId,secret:code,deviceId,publicKey:keys.publicKey,proof,label:os.hostname(),platform:linkedRuntimePlatform(process.platform),architecture:process.arch==='arm64'?'arm64':'x64',runtimeVersion,releaseChannel,agentIds})})
 const data=record(await jsonData(response)),outboundIdentity=sanitizeIdentity({...data,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'})} as RuntimeIdentity);await persistIdentity(outboundIdentity);await heartbeat();process.stdout.write('Paired.\n')
}
async function acknowledgeRotation(value:RuntimeIdentity,deliveryId:string){const response=await new DeviceApiClient(api,value).post(`/api/v1/linked-computers/${value.deviceId}/credentials/rotation/ack`,{rotationDeliveryId:deliveryId});if(!response.ok)throw new Error('rotation acknowledgement rejected')}
export function nativeWorkspaceSyncSupported(platform=process.platform){return workspaceSyncNativeSupported(platform)}
export function linkedRuntimeHeartbeatBody(
  platform = process.platform,
  hermesProbe: LocalHermesProbe = { availableAgentIds: ['pip'] },
  desktop: { watch?: boolean; control?: boolean } = {},
) {
  const sync = nativeWorkspaceSyncSupported(platform)
  const hermesReady = hermesProbe.availableAgentIds.length > 0
  const capabilities = [
    ...(hermesReady ? ['workspace.execute' as const] : []),
    ...(sync ? ['workspace.sync' as const] : []),
    ...(desktop.watch ? ['desktop.watch' as const] : []),
    ...(desktop.control ? ['desktop.control' as const] : []),
  ]
  return {
    runtimeVersion,
    health: hermesReady ? 'ok' as const : 'degraded' as const,
    capabilities,
    availableAgentIds: hermesProbe.availableAgentIds,
    ...(hermesProbe.availableProfiles ? { availableProfiles: hermesProbe.availableProfiles } : {}),
    ...(hermesProbe.hermesVersion ? { hermesVersion: hermesProbe.hermesVersion } : {}),
    ...(hermesProbe.healthReason ? { healthReason: hermesProbe.healthReason } : {}),
    ...(sync ? { syncProtocolVersion: 1 as const } : {}),
    claimRotation: true,
  }
}
export function linkedRuntimeSyncClaimBody(){return{runtimeVersion,syncProtocolVersion:1 as const}}
export function linkedRuntimeWorkbenchClaimBody(){return{runtimeVersion,workbenchProtocolVersion:1 as const}}
export function linkedRuntimeAgentClaimBody(){return{...linkedRuntimeAgentHostClaimBody(),runtimeVersion}}
async function heartbeat() {
  let i = await identity()
  if (i.pendingRotationDeliveryId) i = await handleRotation(i, { rotation: null }, persistIdentity, identity, acknowledgeRotation)
  const hermesProbe = await probeLocalHermes()
  const updateReason = readHermesUpdateHealthReason(process.env)
  const probeForBeat = hermesProbe.availableAgentIds.length > 0 && updateReason
    ? { ...hermesProbe, healthReason: updateReason }
    : hermesProbe
  linkedRunCapacity.setHealthyAgentIds(hermesProbe.availableAgentIds)
  const desktopProbe = process.platform === 'darwin'
    ? await probeDesktopCapabilities().catch(() => ({ watch: false, control: false }))
    : { watch: false, control: false }
  const client = new DeviceApiClient(api, i)
  const data = await client.postParsed(
    `/api/v1/linked-computers/${i.deviceId}/heartbeat`,
    linkedRuntimeHeartbeatBody(process.platform, probeForBeat, {
      watch: desktopProbe.watch,
      control: desktopProbe.control,
    }),
    jsonData,
  )
  await handleRotation(i, data, persistIdentity, identity, acknowledgeRotation)
  scheduleHermesUpdateAfterHeartbeat({
    client,
    env: process.env,
    isIdle: () => isRuntimeIdleForHermesUpdate(linkedRunCapacity),
    probedVersion: hermesProbe.hermesVersion ?? null,
    setAcceptingClaims: (accepting) => linkedRunCapacity.setAcceptingClaims(accepting),
    log: (message) => { try { process.stderr.write(`${message}\n`) } catch { /* ignore */ } },
  })
}

async function claim(capacity:LinkedRunClaimCapacity):Promise<Job|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/runs/claim`,{runtimeVersion,saturatedAgentIds:capacity.saturatedAgentIds});if(response.status===204)return null;return await jsonData(response) as Job}
async function syncClaim():Promise<WorkspaceSyncRuntimeJob|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/sync/claim`,linkedRuntimeSyncClaimBody());if(response.status===204)return null;return await jsonData(response) as WorkspaceSyncRuntimeJob}
async function workbenchClaim():Promise<WorkbenchRuntimeJob|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/workbench/claim`,linkedRuntimeWorkbenchClaimBody());if(response.status===204)return null;return await jsonData(response) as WorkbenchRuntimeJob}
async function workbenchSessionsClaim():Promise<WorkbenchSessionClaim|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/workbench/sessions/claim`,linkedRuntimeWorkbenchSessionsClaimBody());if(response.status===204)return null;return await jsonData(response) as WorkbenchSessionClaim}
async function workbenchTunnelsClaim():Promise<WorkbenchTunnelClaim|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/workbench/tunnel/sessions/claim`,linkedRuntimeWorkbenchTunnelsClaimBody());if(response.status===204)return null;return await jsonData(response) as WorkbenchTunnelClaim}
async function workbenchBrowserSessionsClaim():Promise<WorkbenchBrowserClaim|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/workbench/browser/sessions/claim`,linkedRuntimeWorkbenchBrowserClaimBody());if(response.status===204)return null;return await jsonData(response) as WorkbenchBrowserClaim}
async function agentHostClaim():Promise<AgentHostRuntimeJob|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/agents/claim`,linkedRuntimeAgentClaimBody());if(response.status===204)return null;return await jsonData(response) as AgentHostRuntimeJob}
async function downloadAgentSkillPack(artifactPath:string,expectedContentSha256:string){
  const i=await identity()
  const resolvedPath=artifactPath.includes('{deviceId}')?artifactPath.replace('{deviceId}',i.deviceId):artifactPath
  const {downloadSkillPackArchive}=await import('./skill-pack-apply')
  const apiClient=await client()
  const response=await apiClient.get(resolvedPath)
  if(!response.ok)throw new Error(`skill pack download rejected (${response.status})`)
  let consumed=false
  return downloadSkillPackArchive({
    url:resolvedPath,
    expectedContentSha256,
    fetcher:async()=>{
      if(consumed)throw new Error('skill pack fetcher reused')
      consumed=true
      return response
    },
  })
}
async function localHermes(agentId:string,body:{prompt:string;images?:Array<{url:string;contentType:string}>;model?:string;provider?:string;working_directory:string;yolo?:boolean},helpers?:{onEvents?:(events:unknown[])=>void|Promise<void>;onQueued?:(reason:'agent_capacity'|'gateway_draining'|'runtime_restarting')=>void|Promise<void>;onStarted?:(localHermesRunId:string)=>void|Promise<void>;resumeRunId?:string}):Promise<unknown>{return callLocalHermes(agentId,body,process.env,fetch,(ms)=>new Promise(r=>setTimeout(r,ms)),helpers)}
async function run(job:Job){const i=await identity(),agentId=job.agentId||'pip';return executeJob({...job},i,maps,(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body),(body,helpers)=>localHermes(agentId,body,helpers))}
async function syncRun(job:WorkspaceSyncRuntimeJob){const i=await identity();return executeWorkspaceSyncJob(job,{registry:maps,stateRoot,spool:syncSpool,post:(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body)})}
async function workbenchRun(job:WorkbenchRuntimeJob){const i=await identity();return executeWorkbenchJob(job,i,maps,(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body))}
async function workbenchSessionsRun(claim:WorkbenchSessionClaim){const i=await identity();return runWorkbenchSessionClaim(claim,maps,(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body))}
async function workbenchTunnelsRun(claim:WorkbenchTunnelClaim){const i=await identity();return runWorkbenchTunnelClaim(claim,maps,(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body))}
async function workbenchBrowserSessionsRun(claim:WorkbenchBrowserClaim){const i=await identity();return runWorkbenchBrowserClaim(claim,maps,(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body))}
async function workbenchDesktopSessionsClaim():Promise<DesktopClaim|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/workbench/desktop/sessions/claim`,{runtimeVersion,workbenchDesktopSessionsProtocolVersion:1});if(response.status===204)return null;return await jsonData(response) as DesktopClaim}
async function workbenchDesktopSessionsRun(claim:DesktopClaim){const i=await identity();return runDesktopClaim(claim,(path,body)=>post(path,body),i.deviceId)}
async function waitForAgentIdle(agentId:string,timeoutMs:number){const deadline=Date.now()+timeoutMs;const {localHermesAgentHasActiveWork}=await import('./hermes');while(Date.now()<deadline){if(linkedRunCapacity.activeCount(agentId)===0&&!(await localHermesAgentHasActiveWork(agentId)))return true;await new Promise(r=>setTimeout(r,500))}return false}
async function envProviderCanary(agentId:string,provider:string,model:string){const {probeLocalHermesAdminConfig,listLocalHermesModels}=await import('./hermes');const modelIds=await listLocalHermesModels(agentId).catch(()=>[] as string[]);const config=await probeLocalHermesAdminConfig(agentId).catch(()=>null);const providerToken=provider.split(/[-_:/]/)[0].toLowerCase();const modelPresent=modelIds.some(id=>{const lower=id.toLowerCase();return lower===model.toLowerCase()||lower.startsWith(`${providerToken}-`)||lower.startsWith(`${providerToken}/`)||lower.includes(`/${providerToken}/`)});const configPresent=Boolean(config&&JSON.stringify(config).toLowerCase().includes(provider.toLowerCase()));if(!modelPresent&&!configPresent)return{ok:false as const,modelIds,error:`Provider ${provider} is not advertised on the running ${agentId} gateway (no restart performed)`};return{ok:true as const,modelIds}}
async function agentHostRun(job:AgentHostRuntimeJob){const i=await identity();const outcome=await executeAgentHostJob(job,{downloadSkillPack:async({artifactPath,expectedContentSha256})=>downloadAgentSkillPack(artifactPath,expectedContentSha256),waitForAgentIdle,providerCanary:async({agentId,provider,model,applyMode})=>{if(applyMode==='env'){try{return await envProviderCanary(agentId,provider,model)}catch(error){return{ok:false,modelIds:[],error:error instanceof Error?error.message:'Provider env canary failed'}}}try{const output=await callLocalHermes(agentId,{prompt:'Reply exactly PIB_CREDENTIAL_OK. Do not use tools.',model,provider,working_directory:process.cwd()}, {...process.env,PIB_LOCAL_HERMES_RUN_TIMEOUT_MS:'60000'});const text=typeof output==='string'?output:JSON.stringify(output);if(!text.includes('PIB_CREDENTIAL_OK'))return{ok:false,modelIds:[],error:'Provider canary returned an unexpected response'};return{ok:true,modelIds:await listLocalHermesModels(agentId)}}catch(error){return{ok:false,modelIds:[],error:error instanceof Error?error.message:'Provider canary failed'}}}});await post(`/api/v1/linked-computers/${i.deviceId}/agents/jobs/${job.jobId}/complete`,{leaseToken:job.leaseToken,ok:outcome.ok,...(outcome.ok?{result:outcome.result}:{error:outcome.error})})}
async function syncFlush(){const i=await identity();return syncSpool.flush((suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body))}
export async function isRevokeAcknowledged(response:Response){if(!response.ok)return false;try{const body=record(await response.json());return body.revoked===true&&typeof body.code==='string'&&['device_revoked','already_revoked'].includes(body.code)}catch{return false}}
async function signedRemoteRevoke(){const i=await identity(),response=await new DeviceApiClient(api,i).post(`/api/v1/linked-computers/${i.deviceId}/revoke`,{reason:'local-user-revoked',runtimeVersion});if(!await isRevokeAcknowledged(response))throw new Error('remote revoke unavailable')}
async function clearRevocation(){await store.clear();fs.rmSync(revocationMarker,{force:true})}
export async function recoverPendingRevocation(attempt:()=>Promise<void>,clear:()=>Promise<void>,wait:(ms:number)=>Promise<void>,stop:()=>boolean){let delay=1000;while(!stop()){try{await attempt();await clear();return true}catch{await wait(delay);delay=Math.min(delay*2,30000)}}return false}
export async function heartbeatForever(beat:()=>Promise<void>,stop:()=>boolean,intervalMs=60_000,wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms)),onAttempt:()=>void|Promise<void>=()=>undefined){const retryCap=Math.min(Math.max(1_000,intervalMs),30_000);let retryDelay=Math.min(1_000,retryCap);while(!stop()){try{await Promise.resolve(onAttempt()).catch(()=>undefined);await beat();retryDelay=Math.min(1_000,retryCap);if(!stop())await wait(intervalMs)}catch{if(!stop())await wait(retryDelay);retryDelay=Math.min(retryDelay*2,retryCap)}}}
export async function runRuntimeServicePollers(...pollers:Array<()=>Promise<void>>){await Promise.all(pollers.map(poller=>poller()))}
async function service(){let stopped=false;process.once('SIGTERM',()=>{stopped=true});process.once('SIGINT',()=>{stopped=true});if(fs.existsSync(revocationMarker)){await recoverPendingRevocation(signedRemoteRevoke,clearRevocation,ms=>new Promise(r=>setTimeout(r,ms)),()=>stopped);return}const livenessFile=process.env.PIB_RUNTIME_LIVENESS_FILE;const pollers=[()=>pollForever(claim,run,()=>stopped,{capacity:linkedRunCapacity}),()=>pollWorkbenchForever(workbenchClaim,workbenchRun,()=>stopped),()=>pollWorkbenchSessionsForever(workbenchSessionsClaim,workbenchSessionsRun,()=>stopped),()=>pollWorkbenchTunnelsForever(workbenchTunnelsClaim,workbenchTunnelsRun,()=>stopped),()=>pollWorkbenchBrowserForever(workbenchBrowserSessionsClaim,workbenchBrowserSessionsRun,()=>stopped),()=>pollWorkbenchDesktopForever(workbenchDesktopSessionsClaim,workbenchDesktopSessionsRun,()=>stopped),()=>pollAgentHostForever(agentHostClaim,agentHostRun,()=>stopped),()=>pollRelayForever({stop:()=>stopped,getDeviceId:async()=>(await identity()).deviceId,post:(path,body)=>post(path,body)}),()=>heartbeatForever(heartbeat,()=>stopped,60_000,ms=>new Promise(r=>setTimeout(r,ms)),()=>{if(livenessFile)touchRuntimeHeartbeatLiveness(livenessFile)})];if(nativeWorkspaceSyncSupported())pollers.push(()=>pollWorkspaceSyncForever(syncClaim,syncRun,syncFlush,async()=>undefined,()=>stopped));await runRuntimeServicePollers(...pollers)}
async function supervise(){let stopped=false;process.once('SIGTERM',()=>{stopped=true});process.once('SIGINT',()=>{stopped=true});await superviseRuntimeService({stateRoot,executable:process.execPath,env:process.env,stop:()=>stopped})}
async function revoke(){fs.mkdirSync(stateRoot,{recursive:true,mode:0o700});fs.writeFileSync(revocationMarker,JSON.stringify({pending:true,createdAt:new Date().toISOString()}),{mode:0o600});const result=await revokeAndCleanup(signedRemoteRevoke,clearRevocation);if(result.remoteRevokePending){process.stderr.write('Remote revoke pending; secure identity retained for revoke-only retry.\n');throw new Error('remote revoke pending')}}
function option(args:string[],name:string){const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`${name} is required`);return args[i+1]}
async function confirmMapping(mappingId:string,present:boolean){const i=await identity(),response=await new DeviceApiClient(api,i).post(`/api/v1/linked-computers/${i.deviceId}/mappings/${mappingId}/confirm`,{present});if(!response.ok)throw new Error('mapping confirmation rejected')}
export async function main(argv=process.argv.slice(2)){const [cmd,...args]=argv;if(cmd==='pair')return pair(option(args,'--challenge'),releaseChannelFrom(args),agentIdsFrom(args));if(cmd==='service'||cmd==='bridge')return service();if(cmd==='supervise')return supervise();if(cmd==='heartbeat')return heartbeat();if(cmd==='map'){const id=option(args,'--mapping');maps.map(id,option(args,'--folder'));await confirmMapping(id,true);return}if(cmd==='unmap'){const id=option(args,'--mapping');maps.unmap(id);await confirmMapping(id,false);return}if(cmd==='status'){process.stdout.write(JSON.stringify({paired:await store.get('identity').then(()=>true,()=>false),mappings:maps.status()})+'\n');return}if(cmd==='revoke')return revoke();throw new Error('usage: pib-runtime pair|supervise|service|heartbeat|map|unmap|status|revoke')}
if(require.main===module)main().catch(e=>{console.error(redactLog(e instanceof Error?e.message:String(e)));process.exitCode=1})
