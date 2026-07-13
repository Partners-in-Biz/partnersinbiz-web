import { NextRequest,NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest } from '@/lib/linked-computers/http'
import { processDeviceCleanupBatch, removeOwnedDevice } from '@/lib/linked-computers/store'
import { lifecycleError,noStoreHeaders } from '@/lib/linked-computers/http'

type Context={params:Promise<{deviceId:string}>}
export async function handleDeviceRevoke(req:NextRequest,deviceId:string,auth=authenticateSignedDeviceRequest,remove=removeOwnedDevice,cleanup=processDeviceCleanupBatch):Promise<Response>{try{const raw=await req.text(),identity=await auth(req,deviceId,raw);await remove({deviceId,actorUserId:identity.ownerUserId});const cleanupStatus=await cleanup(deviceId).catch(()=>({done:false,processed:0,phase:'retryable'}));return NextResponse.json({revoked:true,code:'device_revoked',cleanup:cleanupStatus},{status:202,headers:noStoreHeaders})}catch(error){return lifecycleError(error)}}
export async function POST(req:NextRequest,context:Context){return handleDeviceRevoke(req,(await context.params).deviceId)}
