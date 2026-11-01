$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Get-Location).Path
$destZip = Join-Path $root 'udhyam-pay-backend-complete.zip'
$stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) "udhyam-pay-pkg-$(Get-Random)"

if (Test-Path $destZip) {
  Remove-Item $destZip -Force
}

if (Test-Path $stagingDir) {
  Remove-Item $stagingDir -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingDir | Out-Null

$itemsToCopy = @(
  'src',
  'prisma',
  'tests',
  'scripts',
  'docker',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.verify.json',
  'vitest.config.mts',
  'eslint.config.mjs',
  'docker-compose.yml',
  'Dockerfile',
  '.dockerignore',
  '.gitignore',
  '.prettierrc.json',
  '.prettierignore',
  '.env.example',
  'README.md',
  'STATUS.md',
  'AUDIT_REPORT.md',
  'IMPLEMENTATION_PLAN.md',
  'FINAL_VERIFICATION_REPORT.md'
)

Write-Host "Staging files to $stagingDir ..."
foreach ($item in $itemsToCopy) {
  $src = Join-Path $root $item
  if (Test-Path $src) {
    $dest = Join-Path $stagingDir $item
    if ((Get-Item $src) -is [System.IO.DirectoryInfo]) {
      Copy-Item -Path $src -Destination $dest -Recurse -Force
    } else {
      Copy-Item -Path $src -Destination $dest -Force
    }
  }
}

Write-Host "Creating $destZip with standard forward-slash entry paths..."
$zip = [System.IO.Compression.ZipFile]::Open($destZip, [System.IO.Compression.ZipArchiveMode]::Create)
Get-ChildItem -Path $stagingDir -Recurse -File | ForEach-Object {
  $relativePath = $_.FullName.Substring($stagingDir.Length + 1).Replace('\', '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$zip.Dispose()

Remove-Item $stagingDir -Recurse -Force
Write-Host "Archive created successfully!"
Get-Item $destZip | Select-Object Name, Length, LastWriteTime | Format-List
