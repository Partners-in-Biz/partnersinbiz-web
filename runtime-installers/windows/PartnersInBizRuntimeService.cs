using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text.Json;
using System.Threading;

namespace PartnersInBiz {
  public sealed class RuntimeService : ServiceBase {
    readonly string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"PartnersInBiz");
    readonly object childLock=new object();
    Process child; Timer pairingTimer; Thread supervisor; CancellationTokenSource stopping;
    string RuntimePath()=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),@"Partners in Biz\current\pib-runtime.exe");
    ProcessStartInfo RuntimeInfo(string arguments,bool stdin=false){var info=new ProcessStartInfo(RuntimePath(),arguments){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=stdin};info.EnvironmentVariables["PIB_RUNTIME_STATE_DIR"]=root;return info;}
    public RuntimeService(){ServiceName="PartnersInBizRuntime";CanStop=true;CanShutdown=true;}
    protected override void OnStart(string[] args){stopping=new CancellationTokenSource();supervisor=new Thread(()=>Supervise(stopping.Token)){IsBackground=true,Name="PiB runtime supervisor"};supervisor.Start();pairingTimer=new Timer(_=>ClaimPairing(),null,0,2000);}
    void Supervise(CancellationToken token){var backoff=1000;while(!token.IsCancellationRequested){try{var process=Process.Start(RuntimeInfo("supervise"));lock(childLock)child=process;while(!token.IsCancellationRequested&&!process.WaitForExit(500)){}if(token.IsCancellationRequested)break;EventLog.WriteEntry("Runtime worker supervisor exited; restarting.",EventLogEntryType.Warning);backoff=Math.Min(backoff*2,30000);}catch(Exception e){EventLog.WriteEntry("Runtime worker supervisor start failed: "+e.GetType().Name,EventLogEntryType.Error);backoff=Math.Min(backoff*2,30000);}if(token.WaitHandle.WaitOne(backoff))break;}lock(childLock)child=null;}
    void RestartWorker(){lock(childLock){if(child!=null&&!child.HasExited){/* supervise owns the service child; kill the whole tree so a restart cannot leave an orphan claiming work. */child.Kill(true);child.WaitForExit(15000);}}}
    protected override void OnCustomCommand(int command){if(command!=128)return;try{var revoke=Process.Start(RuntimeInfo("revoke"));revoke.WaitForExit(30000);RestartWorker();}catch(Exception e){EventLog.WriteEntry("Credential cleanup failed: "+e.GetType().Name,EventLogEntryType.Error);}}
    void ClaimPairing(){string ready=Path.Combine(root,"pairing.ready"),claim=Path.Combine(root,"pairing.claimed");try{if(!File.Exists(ready))return;File.Move(ready,claim);var plain=ProtectedData.Unprotect(File.ReadAllBytes(claim),null,DataProtectionScope.LocalMachine);File.Delete(claim);var handoff=JsonSerializer.Deserialize<Handoff>(plain);CryptographicOperations.ZeroMemory(plain);var channel=handoff!=null&&handoff.releaseChannel=="internal"?"internal":"stable";var pair=Process.Start(RuntimeInfo("pair --challenge "+handoff.challengeId+" --channel "+channel,true));pair.StandardInput.WriteLine(handoff.code);pair.StandardInput.Close();if(!pair.WaitForExit(30000)||pair.ExitCode!=0)throw new InvalidOperationException("pairing failed");RestartWorker();}catch(Exception e){EventLog.WriteEntry("Pairing handoff failed: "+e.GetType().Name,EventLogEntryType.Error);try{File.Delete(claim);}catch{}}}
    protected override void OnStop(){pairingTimer?.Dispose();stopping?.Cancel();RestartWorker();supervisor?.Join(15000);stopping?.Dispose();}
    protected override void OnShutdown(){OnStop();base.OnShutdown();}
    public static void Main(){ServiceBase.Run(new RuntimeService());}
    sealed class Handoff{public string challengeId{get;set;}public string code{get;set;}public string releaseChannel{get;set;}}
  }
}
