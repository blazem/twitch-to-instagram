# Run in PowerShell 7. Generates a local, machine-specific 15-key profile.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$output = Join-Path $PSScriptRoot 'Twitch to Instagram.streamDeckProfile'
if (Test-Path -LiteralPath $output) { throw 'A generated profile already exists. Rename it before generating another.' }
$profileId = [guid]::NewGuid().ToString().ToUpper()
$pageId = [guid]::NewGuid().ToString().ToLower()
$defaultId = [guid]::NewGuid().ToString().ToLower()
$manifest = @{Device=@{Model='20GBA9901'};Name='Twitch to Instagram';Pages=@{Current=$pageId;Default=$defaultId;Pages=@($pageId)};Version='3.0'}
function New-Button($file, $title) {
    return @{ActionID=[guid]::NewGuid().ToString();LinkedTitle=$true;Name='Open';Resources=$null;Settings=@{path=(Join-Path $PSScriptRoot $file)};State=0;States=@(@{Title=$title;ShowTitle=$true;FontFamily='Arial';FontSize=14;FontStyle='Bold';TitleAlignment='middle';TitleColor='#ffffff'});UUID='com.elgato.streamdeck.system.open'}
}
$page = @{Controllers=@(@{Type='Keypad';Actions=@{'0,0'=(New-Button 'Post to Instagram.vbs' "POST`nLIVE");'1,0'=(New-Button 'Open Setup.vbs' 'SETUP')}});Icon='';Name='Twitch to Instagram'}
$blank = @{Controllers=@(@{Type='Keypad';Actions=$null});Icon='';Name=''}
$zip = [IO.Compression.ZipFile]::Open($output,[IO.Compression.ZipArchiveMode]::Create)
try {
    $entries = @{
        "$profileId.sdProfile/manifest.json"=$manifest
        "$profileId.sdProfile/Profiles/$pageId/manifest.json"=$page
        "$profileId.sdProfile/Profiles/$defaultId/manifest.json"=$blank
    }
    foreach ($name in $entries.Keys) {
        $entry=$zip.CreateEntry($name)
        $writer=[IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
        try {$writer.Write(($entries[$name] | ConvertTo-Json -Depth 12 -Compress))} finally {$writer.Dispose()}
    }
} finally {$zip.Dispose()}
Write-Output "Created $output"
Write-Output 'Open it to import, then select Twitch to Instagram in the Stream Deck profile dropdown.'
