# Packages the extension into a Chrome Web Store-ready zip with only required files.

$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
$OutDir = Join-Path $RootDir "dist"
$ZipName = "recharge.zip"
$ZipPath = Join-Path $OutDir $ZipName

$IncludeFiles = @(
  "manifest.json"
  "background.js"
  "popup.js"
  "popup.html"
  "popup.css"
  "constants.js"
  "offscreen.html"
  "offscreen.js"
  "README.md"
  "icons"
)

# Create output directory if it doesn't exist
if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

# Remove existing zip if present
if (Test-Path $ZipPath) {
  Remove-Item $ZipPath
}

# Create empty zip file (required for Shell.Application)
Set-Content -Path $ZipPath -Value ("PK" + [char]5 + [char]6 + ([byte[]](0*18)))

# Use Shell.Application to add files
$Shell = New-Object -ComObject Shell.Application
$ZipFile = $Shell.NameSpace($ZipPath)

foreach ($Item in $IncludeFiles) {
  $SourcePath = Join-Path $RootDir $Item

  if (Test-Path $SourcePath -PathType Leaf) {
    Write-Host "Adding $Item..."
    $ZipFile.CopyHere($SourcePath, 0x14)
    Start-Sleep -Milliseconds 500
  } elseif (Test-Path $SourcePath -PathType Container) {
    Write-Host "Adding $Item\..."
    $Folder = $Shell.NameSpace($SourcePath)
    $ZipFile.CopyHere($Folder.Items(), 0x14)
    Start-Sleep -Milliseconds 500
  }
}

Write-Host "Waiting for compression to complete..."
Start-Sleep -Seconds 2

Write-Host "Created $ZipPath"
