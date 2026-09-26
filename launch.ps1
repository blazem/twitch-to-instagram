param([ValidateSet('setup','post')][string]$Mode = 'setup')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$address = 'http://127.0.0.1:17863'
$headers = @{ 'X-Local-App' = 'twitch-instagram' }
try { $null = Invoke-RestMethod "$address/status" -Headers $headers -TimeoutSec 2 } catch {
    Start-Process -FilePath $node -ArgumentList ('"{0}"' -f (Join-Path $root 'app.mjs')) -WorkingDirectory $root -WindowStyle Hidden
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Milliseconds 200
        try { $null = Invoke-RestMethod "$address/status" -Headers $headers -TimeoutSec 1; break } catch { }
    }
}
if ($Mode -eq 'post') {
    try { $null = Invoke-RestMethod "$address/post" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 5 }
    catch { Start-Process $address; exit 1 }
    for ($i = 0; $i -lt 200; $i++) {
        Start-Sleep -Seconds 2
        $state = Invoke-RestMethod "$address/status" -Headers $headers -TimeoutSec 5
        if (-not $state.busy) {
            $shell = New-Object -ComObject WScript.Shell
            $null = $shell.Popup($state.message, 12, 'Twitch → Instagram', 64)
            exit
        }
    }
}
Start-Process $address
