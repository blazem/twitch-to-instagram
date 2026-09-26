param([ValidateSet('protect','unprotect')][string]$Mode, [string]$InputFile, [string]$OutputFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$key = [Convert]::FromBase64String($env:TWITCH_IG_SESSION_KEY)
function Protect-Transfer([byte[]]$bytes) {
  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $aes.Key = $key; $aes.GenerateIV()
    $cipher = $aes.CreateEncryptor().TransformFinalBlock($bytes, 0, $bytes.Length)
    [byte[]]$payload = $aes.IV + $cipher
    $mac = New-Object Security.Cryptography.HMACSHA256
    $mac.Key = $key
    try { return ,([byte[]]($payload + $mac.ComputeHash($payload))) } finally { $mac.Dispose() }
  } finally { $aes.Dispose() }
}
function Unprotect-Transfer([byte[]]$bytes) {
  if ($bytes.Length -lt 64) { throw 'Invalid protected transfer.' }
  [byte[]]$payload = $bytes[0..($bytes.Length - 33)]
  [byte[]]$tag = $bytes[($bytes.Length - 32)..($bytes.Length - 1)]
  $mac = New-Object Security.Cryptography.HMACSHA256
  $mac.Key = $key
  try { $expected = $mac.ComputeHash($payload) } finally { $mac.Dispose() }
  $different = 0
  for ($i=0; $i -lt 32; $i++) { $different = $different -bor ($tag[$i] -bxor $expected[$i]) }
  if ($different -ne 0) { throw 'Invalid protected transfer.' }
  $aes = [Security.Cryptography.Aes]::Create()
  try {
    $aes.Key = $key; $aes.IV = [byte[]]$payload[0..15]
    return ,$aes.CreateDecryptor().TransformFinalBlock($payload, 16, $payload.Length - 16)
  } finally { $aes.Dispose() }
}
if ($Mode -eq 'protect') {
  $bytes = Unprotect-Transfer ([IO.File]::ReadAllBytes($InputFile))
  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllText($OutputFile, [Convert]::ToBase64String($result))
} else {
  $bytes = [Convert]::FromBase64String([IO.File]::ReadAllText($InputFile))
  $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes($OutputFile, (Protect-Transfer $result))
}
