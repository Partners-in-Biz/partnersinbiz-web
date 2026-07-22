#!/usr/bin/env node
import { randomUUID, sign } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createPairingIdentity, pairingPayload, redactLog, revokeAndCleanup } from './core'
import type{JSONValue}from'./core'
import { MappingRegistry } from './bridge'
import { DeviceApiClient, type DeviceIdentity } from './client'
import { executeJob, pollForever, type Job } from './worker'
import { callLocalHermes, probeLocalHermes, type LocalHermesProbe } from './hermes'
import {
  DurableSyncSpool,
  executeWorkspaceSyncJob,
  pollWorkspaceSyncForever,
  type WorkspaceSyncRuntimeJob,
} from './workspace-sync'

const api=process.env.PIB_API_BASE||'https://partnersinbiz.online'
const runtimeVersion=process.env.PIB_RUNTIME_VERSION||'1.1.4'
const stateRoot=process.env.PIB_RUNTIME_STATE_DIR||path.join(os.homedir(),'.partnersinbiz')
const revocationMarker=path.join(stateRoot,'revocation-pending.json')
const maps=new MappingRegistry(path.join(stateRoot,'mappings.json'))
const syncSpool=new DurableSyncSpool(path.join(stateRoot,'workspace-sync-receipts.json'))
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
export function applyHeartbeatData<T extends RuntimeIdentity>(current:T,data:unknown):T{const clean=sanitizeIdentity(current),rotation=rotationFrom(data);if(!rotation)return clean;if(rotation.credentialVersion<clean.credentialVersion)return clean;if(rotation.credentialVersion===clean.credentialVersion&&rotation.credential!==clean.credential)return clean;return{...clean,credential:rotation.credential,credentialVersion:rotation.credentialVersion,pendingRotationDeliveryId:rotation.rotationDeliveryId}}
export async function handleRotation<T extends RuntimeIdentity>(current:T,data:unknown,persist:(value:T)=>Promise<void>,read:()=>Promise<T>,ack:(value:T,deliveryId:string)=>Promise<void>):Promise<T>{let durable=applyHeartbeatData(current,data);const deliveryId=durable.pendingRotationDeliveryId;if(durable!==current){try{await persist(durable);const check=sanitizeIdentity(await read());if(check.credential!==durable.credential||check.credentialVersion!==durable.credentialVersion||check.pendingRotationDeliveryId!==deliveryId)throw new Error()}catch{throw new Error('secure identity write failed')}}if(!deliveryId)return durable;try{await ack(durable,deliveryId)}catch{throw new Error('rotation acknowledgement failed')}const acknowledged={...durable};delete acknowledged.pendingRotationDeliveryId;try{await persist(acknowledged as T);durable=sanitizeIdentity(await read())}catch{throw new Error('secure identity write failed')}return durable}

async function pair(challengeId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(challengeId||''))throw new Error('invalid challenge identifier')
 const hermesProbe=await probeLocalHermes()
 if(hermesProbe.availableAgentIds.length===0)throw new Error('Hermes must be installed, configured, and running on this computer before it can be linked')
 const code=await promptSecret('One-time pairing code: '),deviceId=randomUUID(),keys=createPairingIdentity()
 const proof=sign(null,Buffer.from(pairingPayload(challengeId,code,deviceId,keys.publicKey)),keys.privateKey).toString('base64url')
 const response=await fetch(`${api}/api/v1/linked-computers/pairing/exchange`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId,secret:code,deviceId,publicKey:keys.publicKey,proof,label:os.hostname(),platform:linkedRuntimePlatform(process.platform),architecture:process.arch==='arm64'?'arm64':'x64',runtimeVersion})})
 const data=record(await jsonData(response)),outboundIdentity=sanitizeIdentity({...data,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'})} as RuntimeIdentity);await persistIdentity(outboundIdentity);await heartbeat();process.stdout.write('Paired.\n')
}
async function acknowledgeRotation(value:RuntimeIdentity,deliveryId:string){const response=await new DeviceApiClient(api,value).post(`/api/v1/linked-computers/${value.deviceId}/credentials/rotation/ack`,{rotationDeliveryId:deliveryId});if(!response.ok)throw new Error('rotation acknowledgement rejected')}
export function nativeWorkspaceSyncSupported(platform=process.platform){return platform==='darwin'||platform==='linux'}
export function linkedRuntimeHeartbeatBody(platform=process.platform,hermesProbe:LocalHermesProbe={availableAgentIds:['pip']}){const sync=nativeWorkspaceSyncSupported(platform),hermesReady=hermesProbe.availableAgentIds.length>0,capabilities=[...(hermesReady?['workspace.execute' as const]:[]),...(sync?['workspace.sync' as const]:[])];return{runtimeVersion,health:hermesReady?'ok' as const:'degraded' as const,capabilities,availableAgentIds:hermesProbe.availableAgentIds,...(hermesProbe.hermesVersion?{hermesVersion:hermesProbe.hermesVersion}:{}),...(hermesProbe.healthReason?{healthReason:hermesProbe.healthReason}:{}),...(sync?{syncProtocolVersion:1 as const}:{}),claimRotation:true}}
export function linkedRuntimeSyncClaimBody(){return{runtimeVersion,syncProtocolVersion:1 as const}}
async function heartbeat(){let i=await identity();if(i.pendingRotationDeliveryId)i=await handleRotation(i,{rotation:null},persistIdentity,identity,acknowledgeRotation);const hermesProbe=await probeLocalHermes();const response=await new DeviceApiClient(api,i).post(`/api/v1/linked-computers/${i.deviceId}/heartbeat`,linkedRuntimeHeartbeatBody(process.platform,hermesProbe)),data=await jsonData(response);await handleRotation(i,data,persistIdentity,identity,acknowledgeRotation)}
async function claim():Promise<Job|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/runs/claim`,{runtimeVersion});if(response.status===204)return null;return await jsonData(response) as Job}
async function syncClaim():Promise<WorkspaceSyncRuntimeJob|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/sync/claim`,linkedRuntimeSyncClaimBody());if(response.status===204)return null;return await jsonData(response) as WorkspaceSyncRuntimeJob}
async function localHermes(agentId:string,body:{prompt:string;images?:Array<{url:string;contentType:string}>;model?:string;provider?:string;working_directory:string}):Promise<unknown>{return callLocalHermes(agentId,body)}
async function run(job:Job){const i=await identity();return executeJob(job,i,maps,(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body),(body)=>localHermes(job.agentId||'pip',body))}
async function syncRun(job:WorkspaceSyncRuntimeJob){const i=await identity();return executeWorkspaceSyncJob(job,{registry:maps,stateRoot,spool:syncSpool,post:(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body)})}
async function syncFlush(){const i=await identity();return syncSpool.flush((suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body))}
export async function isRevokeAcknowledged(response:Response){if(!response.ok)return false;try{const body=record(await response.json());return body.revoked===true&&typeof body.code==='string'&&['device_revoked','already_revoked'].includes(body.code)}catch{return false}}
async function signedRemoteRevoke(){const i=await identity(),response=await new DeviceApiClient(api,i).post(`/api/v1/linked-computers/${i.deviceId}/revoke`,{reason:'local-user-revoked',runtimeVersion});if(!await isRevokeAcknowledged(response))throw new Error('remote revoke unavailable')}
async function clearRevocation(){await store.clear();fs.rmSync(revocationMarker,{force:true})}
export async function recoverPendingRevocation(attempt:()=>Promise<void>,clear:()=>Promise<void>,wait:(ms:number)=>Promise<void>,stop:()=>boolean){let delay=1000;while(!stop()){try{await attempt();await clear();return true}catch{await wait(delay);delay=Math.min(delay*2,30000)}}return false}
export async function heartbeatForever(beat:()=>Promise<void>,stop:()=>boolean,intervalMs=60_000,wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){while(!stop()){await beat().catch(()=>undefined);if(!stop())await wait(intervalMs)}}
export async function runRuntimeServicePollers(...pollers:Array<()=>Promise<void>>){await Promise.all(pollers.map(poller=>poller()))}
async function service(){let stopped=false;process.once('SIGTERM',()=>{stopped=true});process.once('SIGINT',()=>{stopped=true});if(fs.existsSync(revocationMarker)){await recoverPendingRevocation(signedRemoteRevoke,clearRevocation,ms=>new Promise(r=>setTimeout(r,ms)),()=>stopped);return}const pollers=[()=>pollForever(claim,run,()=>stopped),()=>heartbeatForever(heartbeat,()=>stopped)];if(nativeWorkspaceSyncSupported())pollers.push(()=>pollWorkspaceSyncForever(syncClaim,syncRun,syncFlush,async()=>undefined,()=>stopped));await runRuntimeServicePollers(...pollers)}
async function revoke(){fs.mkdirSync(stateRoot,{recursive:true,mode:0o700});fs.writeFileSync(revocationMarker,JSON.stringify({pending:true,createdAt:new Date().toISOString()}),{mode:0o600});const result=await revokeAndCleanup(signedRemoteRevoke,clearRevocation);if(result.remoteRevokePending){process.stderr.write('Remote revoke pending; secure identity retained for revoke-only retry.\n');throw new Error('remote revoke pending')}}
function option(args:string[],name:string){const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`${name} is required`);return args[i+1]}
async function confirmMapping(mappingId:string,present:boolean){const i=await identity(),response=await new DeviceApiClient(api,i).post(`/api/v1/linked-computers/${i.deviceId}/mappings/${mappingId}/confirm`,{present});if(!response.ok)throw new Error('mapping confirmation rejected')}
export async function main(argv=process.argv.slice(2)){const [cmd,...args]=argv;if(cmd==='pair')return pair(option(args,'--challenge'));if(cmd==='service'||cmd==='bridge')return service();if(cmd==='heartbeat')return heartbeat();if(cmd==='map'){const id=option(args,'--mapping');maps.map(id,option(args,'--folder'));await confirmMapping(id,true);return}if(cmd==='unmap'){const id=option(args,'--mapping');maps.unmap(id);await confirmMapping(id,false);return}if(cmd==='status'){process.stdout.write(JSON.stringify({paired:await store.get('identity').then(()=>true,()=>false),mappings:maps.status()})+'\n');return}if(cmd==='revoke')return revoke();throw new Error('usage: pib-runtime pair|service|heartbeat|map|unmap|status|revoke')}
if(require.main===module)main().catch(e=>{console.error(redactLog(e instanceof Error?e.message:String(e)));process.exitCode=1})
