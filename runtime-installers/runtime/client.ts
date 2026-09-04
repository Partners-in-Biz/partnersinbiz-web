import { createPrivateKey, randomUUID, sign } from 'node:crypto'

export type DeviceIdentity = { deviceId:string; credential:string; credentialVersion:number; privateKey:string; ownerUserId?:string }
export const LINKED_RUNTIME_REQUEST_TIMEOUT_MS=15_000

export class DeviceApiClient {
  constructor(private baseUrl:string,private identity:DeviceIdentity,private fetcher:typeof fetch=fetch,private now=Date.now,private nonce=randomUUID,private requestTimeoutMs=LINKED_RUNTIME_REQUEST_TIMEOUT_MS) {
    const url=new URL(baseUrl);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('runtime API must use HTTPS')
  }
  get deviceId(){return this.identity.deviceId}
  private signedHeaders(method:string, path:string, body:string){
    const timestamp=String(this.now()),requestId=this.nonce()
    const payload=`${method.toUpperCase()}\n${path}\n${timestamp}\n${requestId}\n${body}`
    return {
      'x-device-id':this.identity.deviceId,
      'x-device-credential':this.identity.credential,
      'x-device-credential-version':String(this.identity.credentialVersion),
      'x-device-timestamp':timestamp,
      'x-device-request-id':requestId,
      'x-device-signature':sign(null,Buffer.from(payload),createPrivateKey(this.identity.privateKey)).toString('base64url'),
    }
  }
  private async request<T=Response>(url:string,init:RequestInit,parse?:(response:Response)=>Promise<T>):Promise<T>{
    const controller=new AbortController(),timeoutMs=Math.max(1_000,this.requestTimeoutMs)
    let timeout:ReturnType<typeof setTimeout>|undefined
    // Keep the deadline around body consumption too. A fetch can resolve when
    // response headers arrive while a broken connection leaves response.json()
    // pending forever; in that state a runtime must be able to retry its
    // heartbeat rather than looking permanently offline.
    const request=Promise.resolve().then(async()=>{
      const response=await this.fetcher(url,{...init,signal:controller.signal})
      if(parse)return parse(response)
      return response as T
    })
    const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('PiB request timed out'))},timeoutMs)})
    try{return await Promise.race([request,deadline])}finally{if(timeout)clearTimeout(timeout)}
  }
  private postInit(path:string,body:unknown):RequestInit{
    if(!path.startsWith('/api/v1/linked-computers/'))throw new Error('outbound endpoint is not allowlisted')
    const raw=JSON.stringify(body)
    return{method:'POST',headers:{'content-type':'application/json',...this.signedHeaders('POST',path,raw)},body:raw}
  }
  async post(path:string,body:unknown){
    return this.request<Response>(this.baseUrl+path,this.postInit(path,body))
  }
  async postParsed<T>(path:string,body:unknown,parse:(response:Response)=>Promise<T>):Promise<T>{
    return this.request<T>(this.baseUrl+path,this.postInit(path,body),parse)
  }
  async get(path:string){
    if(!path.startsWith('/api/v1/linked-computers/'))throw new Error('outbound endpoint is not allowlisted')
    return this.request<Response>(this.baseUrl+path,{method:'GET',headers:{...this.signedHeaders('GET',path,'')}})
  }
}
