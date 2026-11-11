param([int]$RootPid, [int]$Segundos = 0)
# Árbol de procesos de una instancia: working set, working set privado, private bytes y CPU de todos
# sus procesos dentro de una ventana de N segundos.
# Última línea: JSON con los totales.
$all = Get-CimInstance Win32_Process
$hijos = @{}
foreach ($p in $all) { if (-not $hijos.ContainsKey([int]$p.ParentProcessId)) { $hijos[[int]$p.ParentProcessId] = @() }; $hijos[[int]$p.ParentProcessId] += $p }
$arbol = @()
$cola = New-Object System.Collections.Queue
$cola.Enqueue($RootPid)
while ($cola.Count) { $id = $cola.Dequeue(); if ($arbol -contains $id) { continue }; $arbol += $id; if ($hijos.ContainsKey($id)) { foreach ($h in $hijos[$id]) { if ([int]$h.ProcessId -ne $id) { $cola.Enqueue([int]$h.ProcessId) } } } }
$info = @{}
foreach ($p in $all) { if ($arbol -contains [int]$p.ProcessId) { $info[[int]$p.ProcessId] = $p } }
$cpu0 = @{}
foreach ($id in $arbol) { try { $cpu0[$id] = (Get-Process -Id $id -ErrorAction Stop).TotalProcessorTime.TotalMilliseconds } catch {} }
if ($Segundos -gt 0) { Start-Sleep -Seconds $Segundos }
$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $arbol -contains [int]$_.IDProcess }
$filas = foreach ($id in $arbol) {
  $p = $info[$id]; if (-not $p) { continue }
  $cl = [string]$p.CommandLine
  $tipo = if ($cl -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }
  $extra = ''
  if ($cl -match '--utility-sub-type=([^ ]+)') { $extra = $Matches[1] }
  if ($tipo -eq 'renderer') { if ($cl -match '--extension-process') { $extra = 'extension' } elseif ($cl -match '--renderer-client-id=(\d+)') { $extra = 'rcid=' + $Matches[1] } }
  $pf = $perf | Where-Object { [int]$_.IDProcess -eq $id } | Select-Object -First 1
  $cpuMs = $null; $ws = $null; $priv = $null
  try {
    $gp = Get-Process -Id $id -ErrorAction Stop
    if ($Segundos -gt 0) { $cpuMs = [math]::Round($gp.TotalProcessorTime.TotalMilliseconds - $cpu0[$id]) }
    $ws = [math]::Round($gp.WorkingSet64 / 1MB, 1); $priv = [math]::Round($gp.PrivateMemorySize64 / 1MB, 1)
  } catch {}
  [pscustomobject]@{ PID = $id; Tipo = $tipo; Extra = $extra; WSMB = $ws; PrivWSMB = if ($pf) { [math]::Round($pf.WorkingSetPrivate / 1MB, 1) } else { $null }; PrivBytesMB = $priv; CpuMs = $cpuMs }
}
$filas | Sort-Object PrivWSMB -Descending | Format-Table -AutoSize | Out-String -Width 200
$porTipo = @{}
foreach ($f in $filas) { $k = $f.Tipo; if ($f.Extra -and $f.Tipo -ne 'renderer') { $k = $f.Tipo + ':' + $f.Extra }; if (-not $porTipo.ContainsKey($k)) { $porTipo[$k] = 0 }; $porTipo[$k]++ }
$tot = [ordered]@{
  wsMB = [math]::Round(($filas | Measure-Object WSMB -Sum).Sum, 1)
  privWsMB = [math]::Round(($filas | Measure-Object PrivWSMB -Sum).Sum, 1)
  privateBytesMB = [math]::Round(($filas | Measure-Object PrivBytesMB -Sum).Sum, 1)
  procesos = @($filas).Count
  cpuMs = [math]::Round(($filas | Measure-Object CpuMs -Sum).Sum)
  segundos = $Segundos
  tipos = $porTipo
}
'JSON ' + ($tot | ConvertTo-Json -Compress)
