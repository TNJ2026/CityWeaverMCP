param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug',
    [switch]$Stage
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $PSScriptRoot '.tools\dotnet'
$previousRoot = $env:DOTNET_ROOT
$previousX64Root = $env:DOTNET_ROOT_X64
$sdkCommand = (Get-Command dotnet -ErrorAction Stop).Source
if (!$Stage -and (Get-Process Cities2 -ErrorAction SilentlyContinue)) {
    throw 'Save and close Cities: Skylines II before deployment, or use -Stage to build without deploying to the running game.'
}
try {
    if (Test-Path (Join-Path $runtimeRoot 'shared\Microsoft.NETCore.App\6.0.36')) {
        $env:DOTNET_ROOT = $runtimeRoot
        $env:DOTNET_ROOT_X64 = $runtimeRoot
    }
    Push-Location $PSScriptRoot
    try {
        $buildArguments = @('build', 'CityWeaver.csproj', '-c', $Configuration, '--nologo')
        if ($Stage) { $buildArguments += ('-p:LocalModsPath=' + (Join-Path $PSScriptRoot 'artifacts\staged')) }
        & $sdkCommand @buildArguments
        $buildExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    $env:DOTNET_ROOT = $previousRoot
    $env:DOTNET_ROOT_X64 = $previousX64Root
}
exit $buildExitCode
