import Foundation
import Security
import Darwin

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
func safeRelativeName(_ value:String)->Bool{
  !value.isEmpty && value != "." && value != ".." && value.utf8.count <= 255
    && !value.contains("/") && !value.contains("\\") && !value.contains("\0")
}
if arguments[1]=="resolved-path" {
  var buffer=[CChar](repeating:0,count:Int(PATH_MAX))
  guard fcntl(STDIN_FILENO,F_GETPATH,&buffer) != -1 else{exit(1)}
  print(String(cString:buffer));exit(0)
}
if arguments[1]=="rename-excl" {
  guard arguments.count==4,safeRelativeName(arguments[2]),safeRelativeName(arguments[3]) else{exit(2)}
  let status=arguments[2].withCString{source in arguments[3].withCString{target in
    renameatx_np(STDIN_FILENO,source,STDIN_FILENO,target,UInt32(RENAME_EXCL))
  }}
  exit(status == 0 ? 0 : 1)
}
if arguments[1]=="unlink" {
  guard arguments.count==3,safeRelativeName(arguments[2]) else{exit(2)}
  exit(arguments[2].withCString{unlinkat(STDIN_FILENO,$0,0)} == 0 ? 0 : 1)
}
if arguments[1]=="mkdir" {
  guard arguments.count==3,safeRelativeName(arguments[2]) else{exit(2)}
  exit(arguments[2].withCString{mkdirat(STDIN_FILENO,$0,mode_t(0o700))} == 0 ? 0 : 1)
}
if arguments[1]=="rmdir" {
  guard arguments.count==3,safeRelativeName(arguments[2]) else{exit(2)}
  exit(arguments[2].withCString{unlinkat(STDIN_FILENO,$0,AT_REMOVEDIR)} == 0 ? 0 : 1)
}
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
