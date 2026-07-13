using System;
using System.Runtime.InteropServices;
using System.Text;

class CredentialHelper {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct CREDENTIAL { public uint Flags,Type;public string TargetName,Comment;public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;public uint CredentialBlobSize;public IntPtr CredentialBlob;public uint Persist,AttributeCount;public IntPtr Attributes;public string TargetAlias,UserName; }
  [DllImport("advapi32",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredWrite(ref CREDENTIAL credential,uint flags);
  [DllImport("advapi32",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredRead(string target,uint type,uint flags,out IntPtr credential);
  [DllImport("advapi32")]static extern void CredFree(IntPtr pointer);
  [DllImport("advapi32",CharSet=CharSet.Unicode)]static extern bool CredDelete(string target,uint type,uint flags);
  static void Zero(IntPtr pointer,int length){for(var i=0;i<length;i++)Marshal.WriteByte(pointer,i,0);}
  static int Main(string[] args){if(args.Length<1)return 2;var target="PartnersInBiz/runtime/"+(args.Length>1?args[1]:"identity");
    if(args[0]=="put"){var bytes=Encoding.UTF8.GetBytes(Console.In.ReadToEnd());var pointer=Marshal.AllocHGlobal(bytes.Length);try{Marshal.Copy(bytes,0,pointer,bytes.Length);var credential=new CREDENTIAL{Type=1,TargetName=target,CredentialBlobSize=(uint)bytes.Length,CredentialBlob=pointer,Persist=2,UserName="SYSTEM"};return CredWrite(ref credential,0)?0:1;}finally{Array.Clear(bytes,0,bytes.Length);Zero(pointer,bytes.Length);Marshal.FreeHGlobal(pointer);}}
    if(args[0]=="get"){IntPtr pointer;if(!CredRead(target,1,0,out pointer))return 1;try{var credential=Marshal.PtrToStructure<CREDENTIAL>(pointer);if(credential.CredentialBlob==IntPtr.Zero||credential.CredentialBlobSize>512*1024)return 1;var bytes=new byte[credential.CredentialBlobSize];try{Marshal.Copy(credential.CredentialBlob,bytes,0,bytes.Length);Console.OpenStandardOutput().Write(bytes,0,bytes.Length);return 0;}finally{Array.Clear(bytes,0,bytes.Length);}}finally{if(pointer!=IntPtr.Zero)CredFree(pointer);}}
    if(args[0]=="clear")return CredDelete(target,1,0)?0:0;return 2;
  }
}
