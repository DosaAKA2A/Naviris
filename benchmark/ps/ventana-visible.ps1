param([string]$Exe, [string]$ArgsFile, [int]$TopeMs = 30000, [int]$AnchoMin = 600)
# Lanza el navegador y mide, cada ~5 ms, cuándo tiene su primera ventana VISIBLE de más de
# $AnchoMin px de ancho (la de Naviris, no su splash). El código se compila ANTES de lanzar.
# Salida: una línea JSON { pid, t0 (epoch ms), visibleMs }.
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class VV {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int l, t, r, b; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  public static bool Hay(uint pid, int anchoMin) {
    bool hay = false;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { R r; GetWindowRect(h, out r); if (r.r - r.l >= anchoMin) { hay = true; return false; } }
      return true;
    }, IntPtr.Zero);
    return hay;
  }
}
"@
$argumentos = Get-Content -Raw -Encoding UTF8 $ArgsFile | ConvertFrom-Json
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Exe
$psi.UseShellExecute = $false
$psi.Arguments = ($argumentos | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$t0 = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$p = [System.Diagnostics.Process]::Start($psi)
$vis = $null
while ($sw.ElapsedMilliseconds -lt $TopeMs) {
  if ([VV]::Hay([uint32]$p.Id, $AnchoMin)) { $vis = $sw.ElapsedMilliseconds; break }
  Start-Sleep -Milliseconds 5
}
'{"pid":' + $p.Id + ',"t0":' + $t0 + ',"visibleMs":' + $(if ($null -eq $vis) { 'null' } else { $vis }) + '}'
