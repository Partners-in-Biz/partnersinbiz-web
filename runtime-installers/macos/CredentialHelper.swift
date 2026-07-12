import Foundation
import Security
let a=CommandLine.arguments, service="com.partnersinbiz.runtime"
func query(_ name:String)->[String:Any]{[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:name]}
if a.count<2 { exit(2) }
if a[1]=="put" { let data=FileHandle.standardInput.readDataToEndOfFile(); var q=query(a[2]); SecItemDelete(q as CFDictionary); q[kSecValueData as String]=data; exit(SecItemAdd(q as CFDictionary,nil)==errSecSuccess ? 0:1) }
if a[1]=="get" { var q=query(a[2]);q[kSecReturnData as String]=true;q[kSecMatchLimit as String]=kSecMatchLimitOne;var out:CFTypeRef?;guard SecItemCopyMatching(q as CFDictionary,&out)==errSecSuccess,let d=out as? Data else{exit(1)};FileHandle.standardOutput.write(d);exit(0) }
if a[1]=="clear" { SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service] as CFDictionary);exit(0) }
exit(2)
