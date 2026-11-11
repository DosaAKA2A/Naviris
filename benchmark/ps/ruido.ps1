# Qué más gasta CPU en el equipo durante N segundos (para saber con qué ruido se mide). Solo lectura.
param([int]$Segundos = 10)
$a = @{}; Get-Process | ForEach-Object { try { $a[$_.Id] = $_.CPU } catch {} }
Start-Sleep -Seconds $Segundos
$n = [Environment]::ProcessorCount
$l = Get-Process | ForEach-Object { if ($a.ContainsKey($_.Id) -and $_.CPU) { [pscustomobject]@{ Id = $_.Id; Nombre = $_.ProcessName; Pct = [math]::Round(($_.CPU - $a[$_.Id]) / $Segundos / $n * 100, 1) } } } | Sort-Object Pct -Descending
"Total CPU %: " + [math]::Round(($l | Measure-Object Pct -Sum).Sum, 1) + " (nucleos $n)"
$l | Select-Object -First 8 | ForEach-Object { "$($_.Pct)% $($_.Nombre) $($_.Id)" }
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Fg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }
"@
$p = 0; [void][Fg]::GetWindowThreadProcessId([Fg]::GetForegroundWindow(), [ref]$p); "Primer plano: " + (Get-Process -Id $p).ProcessName
