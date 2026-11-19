[CmdletBinding()]
param(
    # Target runtime identifier, e.g. win-x64, linux-x64, osx-arm64.
    [string]$Runtime = 'win-x64',

    [string]$Configuration = 'Release',

    # Framework-dependent build: much smaller, but needs the .NET runtime installed.
    [switch]$FrameworkDependent,

    # Optional settings file copied into the package as appsettings.Local.json (a ready-made preset).
    [string]$LocalSettings,

    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)

$ErrorActionPreference = 'Stop'

$version = (& git -C $PSScriptRoot describe --tags --always --dirty 2>$null)
if (-not $version) {
    $version = 'local'
}

$packageName = "OpenApiVisualizer-$version-$Runtime"
$publishDirectory = Join-Path $OutputDirectory $packageName
$zipPath = "$publishDirectory.zip"

if (Test-Path -LiteralPath $publishDirectory) {
    Remove-Item -LiteralPath $publishDirectory -Recurse -Force
}

$publishArguments = @(
    'publish', (Join-Path $PSScriptRoot 'OpenApiVisualizer.csproj'),
    '--configuration', $Configuration,
    '--runtime', $Runtime,
    '--output', $publishDirectory,
    '-p:DebugType=None',
    '-p:PublishSingleFile=true'
)
if ($FrameworkDependent) {
    $publishArguments += '--self-contained', 'false'
}
else {
    $publishArguments += '--self-contained', 'true', '-p:IncludeNativeLibrariesForSelfExtract=true'
}

& dotnet @publishArguments
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

if ($LocalSettings) {
    Copy-Item -LiteralPath $LocalSettings -Destination (Join-Path $publishDirectory 'appsettings.Local.json')
}

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -LiteralPath $publishDirectory -DestinationPath $zipPath

Write-Information "Package: $zipPath" -InformationAction Continue
[pscustomobject]@{
    Version   = $version
    Runtime   = $Runtime
    Directory = $publishDirectory
    Zip       = $zipPath
}
