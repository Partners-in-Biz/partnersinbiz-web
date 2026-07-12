#!/usr/bin/env node
import fs from 'node:fs'
import { createPublicKey } from 'node:crypto'
import { verifyRelease,type ReleaseManifest } from './core'

function arg(name:string){const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error(`${name} required`);return process.argv[i+1]}
export function verifyReleaseFiles(input:{manifest:string;signature:string;payload:string;publicKey:string;platform:string;architecture:string;currentVersion:string;channel:string;allowDowngrade?:boolean}){
 const manifest=JSON.parse(fs.readFileSync(input.manifest,'utf8')) as ReleaseManifest
 verifyRelease(manifest,fs.readFileSync(input.signature,'utf8').trim(),fs.readFileSync(input.payload),createPublicKey(fs.readFileSync(input.publicKey)),{platform:input.platform,architecture:input.architecture,currentVersion:input.currentVersion,channel:input.channel,allowDowngrade:input.allowDowngrade})
 return manifest
}
if(require.main===module){try{if(process.argv[2]!=='verify')throw new Error('usage: pib-release-manager verify ...');verifyReleaseFiles({manifest:arg('--manifest'),signature:arg('--signature'),payload:arg('--payload'),publicKey:arg('--public-key'),platform:arg('--platform'),architecture:arg('--architecture'),currentVersion:arg('--current-version'),channel:arg('--channel'),allowDowngrade:process.argv.includes('--allow-downgrade')});process.stdout.write('verified\n')}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}}
