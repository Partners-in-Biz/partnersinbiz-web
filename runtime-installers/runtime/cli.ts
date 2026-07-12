#!/usr/bin/env node
import { randomUUID, sign } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { createPairingIdentity, pairingPayload, redactLog, revokeAndCleanup } from './core'
import { MappingRegistry } from './bridge'
import { DeviceApiClient, type DeviceIdentity } from './client'
import { executeJob, pollForever, type Job } from './worker'

const api=process.env.PIB_API_BASE||'https://partnersinbiz.online'
const hermes=process.env.PIB_LOCAL_HERMES||'http://127.0.0.1:8755'
const runtimeVersion=process.env.PIB_RUNTIME_VERSION||'1.0.0'
const stateRoot=process.env.PIB_RUNTIME_STATE_DIR||path.join(os.homedir(),'.partnersinbiz')
const maps=new MappingRegistry(path.join(stateRoot,'mappings.json'))
const helper=process.env.PIB_CREDENTIAL_HELPER||path.join(path.dirname(process.execPath),process.platform==='win32'?'pib-credential-helper.exe':'pib-credential-helper')
const store={async put(name:string,value:string){const {spawnSync}=await import('node:child_process');const r=spawnSync(helper,['put',name],{input:value,stdio:['pipe','ignore','pipe']});if(r.status)throw new Error('secure credential write failed')},async get(name:string){const {execFileSync}=await import('node:child_process');return execFileSync(helper,['get',name],{encoding:'utf8'}).trim()},async clear(){const {execFileSync}=await import('node:child_process');try{execFileSync(helper,['clear'])}catch{}}}

async function promptSecret(label:string){
 if(!process.stdin.isTTY)return new Promise<string>(r=>process.stdin.once('data',d=>r(String(d).trim())))
 process.stderr.write(label);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8')
 return new Promise<string>((resolve,reject)=>{let value='';const done=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');process.stdin.removeListener('data',onData);resolve(value)};const onData=(c:string)=>{if(c==='\u0003'){process.stdin.setRawMode(false);reject(new Error('cancelled'))}else if(c==='\r'||c==='\n')done();else if(c==='\u007f')value=value.slice(0,-1);else if(c>=' ')value+=c};process.stdin.on('data',onData)})
}
async function identity():Promise<DeviceIdentity&Record<string,unknown>>{return JSON.parse(await store.get('identity'))}
async function client(){return new DeviceApiClient(api,await identity())}
async function post(path:string,body:unknown){return (await client()).post(path,body)}
async function jsonData(response:Response){if(!response.ok)throw new Error(`PiB request rejected (${response.status})`);return (await response.json() as any).data}

async function pair(challengeId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(challengeId||''))throw new Error('invalid challenge identifier')
 const code=await promptSecret('One-time pairing code: '),deviceId=randomUUID(),keys=createPairingIdentity()
 const proof=sign(null,Buffer.from(pairingPayload(challengeId,code,deviceId,keys.publicKey)),keys.privateKey).toString('base64url')
 const response=await fetch(`${api}/api/v1/linked-computers/pairing/exchange`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId,secret:code,deviceId,publicKey:keys.publicKey,proof,label:os.hostname(),platform:process.platform==='win32'?'windows':'macos',architecture:process.arch==='arm64'?'arm64':'x64',runtimeVersion})})
 const data=await jsonData(response),outboundIdentity={...data};delete outboundIdentity.transportToken;await store.put('identity',JSON.stringify({...outboundIdentity,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'})}));await heartbeat(true);process.stdout.write('Paired.\n')
}
async function heartbeat(bootstrapTransport=false){const i=await identity(),response=await post(`/api/v1/linked-computers/${i.deviceId}/heartbeat`,{runtimeVersion,health:'ok',capabilities:['workspace.execute'],bootstrapTransport,claimRotation:true});const data=await jsonData(response);if(data?.credential){await store.put('identity',JSON.stringify({...i,...data}))}}
async function claim():Promise<Job|null>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/runs/claim`,{runtimeVersion});if(response.status===204)return null;return jsonData(response)}
async function localHermes(body:any){const response=await fetch(`${hermes}/v1/runs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error('Local Hermes execution failed');return response.json()}
async function run(job:Job){const i=await identity();return executeJob(job,i,maps,(suffix,body)=>post(`/api/v1/linked-computers/${i.deviceId}${suffix}`,body),localHermes)}
async function service(){let stopped=false;process.once('SIGTERM',()=>{stopped=true});process.once('SIGINT',()=>{stopped=true});let lastHeartbeat=0;await pollForever(async()=>{if(Date.now()-lastHeartbeat>60000){await heartbeat();lastHeartbeat=Date.now()}return claim()},run,()=>stopped)}
async function revoke(){return revokeAndCleanup(async()=>{const i=await identity();const response=await post(`/api/v1/linked-computers/${i.deviceId}/revoke`,{reason:'local-user-revoked',runtimeVersion});if(!response.ok)throw new Error('remote revoke unavailable')},()=>store.clear()).then(x=>{if(x.remoteRevokePending)process.stderr.write('Remote revoke pending; local credentials were removed.\n')})}
function option(args:string[],name:string){const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`${name} is required`);return args[i+1]}
export async function main(argv=process.argv.slice(2)){const [cmd,...args]=argv;if(cmd==='pair')return pair(option(args,'--challenge'));if(cmd==='service'||cmd==='bridge')return service();if(cmd==='heartbeat')return heartbeat();if(cmd==='map'){maps.map(option(args,'--mapping'),option(args,'--folder'));return}if(cmd==='unmap'){maps.unmap(option(args,'--mapping'));return}if(cmd==='status'){process.stdout.write(JSON.stringify({paired:await store.get('identity').then(()=>true,()=>false),mappings:maps.status()})+'\n');return}if(cmd==='revoke')return revoke();throw new Error('usage: pib-runtime pair|service|heartbeat|map|unmap|status|revoke')}
if(require.main===module)main().catch(e=>{console.error(redactLog(e instanceof Error?e.message:String(e)));process.exitCode=1})
