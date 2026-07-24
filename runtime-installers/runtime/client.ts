import { createPrivateKey, randomUUID, sign } from 'node:crypto'

export type DeviceIdentity = { deviceId:string; credential:string; credentialVersion:number; privateKey:string }

export class DeviceApiClient {
  constructor(private baseUrl:string,private identity:DeviceIdentity,private fetcher:typeof fetch=fetch,private now=Date.now,private nonce=randomUUID) {
    const url=new URL(baseUrl);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('runtime API must use HTTPS')
  }
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
  async post(path:string,body:unknown){
    if(!path.startsWith('/api/v1/linked-computers/'))throw new Error('outbound endpoint is not allowlisted')
    const raw=JSON.stringify(body)
    return this.fetcher(this.baseUrl+path,{method:'POST',headers:{'content-type':'application/json',...this.signedHeaders('POST',path,raw)},body:raw})
  }
  async get(path:string){
    if(!path.startsWith('/api/v1/linked-computers/'))throw new Error('outbound endpoint is not allowlisted')
    return this.fetcher(this.baseUrl+path,{method:'GET',headers:{...this.signedHeaders('GET',path,'')}})
  }
}
