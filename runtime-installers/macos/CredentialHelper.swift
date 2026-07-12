import Foundation
import Security

let arguments=CommandLine.arguments
let service="com.partnersinbiz.runtime"
func query(_ account:String)->[String:Any]{[
  kSecClass as String:kSecClassGenericPassword,
  kSecAttrService as String:service,
  kSecAttrAccount as String:account,
]}
func read(_ account:String)->Data?{
  var request=query(account);request[kSecReturnData as String]=true;request[kSecMatchLimit as String]=kSecMatchLimitOne
  var result:CFTypeRef?
  guard SecItemCopyMatching(request as CFDictionary,&result)==errSecSuccess else{return nil}
  return result as? Data
}
guard arguments.count>=2 else{exit(2)}
if arguments[1]=="put" {
  guard arguments.count==3 else{exit(2)}
  let account=arguments[2],data=FileHandle.standardInput.readDataToEndOfFile(),selector=query(account)
  var status=SecItemUpdate(selector as CFDictionary,[kSecValueData as String:data] as CFDictionary)
  if status==errSecItemNotFound { var item=selector;item[kSecValueData as String]=data;status=SecItemAdd(item as CFDictionary,nil) }
  guard status==errSecSuccess,read(account)==data else{exit(1)}
  exit(0)
}
if arguments[1]=="get" { guard arguments.count==3,let data=read(arguments[2]) else{exit(1)};FileHandle.standardOutput.write(data);exit(0) }
if arguments[1]=="clear" { SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service] as CFDictionary);exit(0) }
exit(2)
