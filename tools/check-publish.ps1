param([switch]$RequireStagedBuild, [switch]$UpdateVersion)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$publishPath = Join-Path $projectRoot 'Properties\PublishConfiguration.xml'
$projectPath = Join-Path $projectRoot 'CityWeaver.csproj'
$profileName = if ($UpdateVersion) { 'PublishNewVersion.pubxml' } else { 'PublishNewMod.pubxml' }
$profilePath = Join-Path $projectRoot ('Properties\PublishProfiles\' + $profileName)

[xml]$publish = Get-Content -LiteralPath $publishPath -Raw
[xml]$project = Get-Content -LiteralPath $projectPath -Raw
[xml]$profile = Get-Content -LiteralPath $profilePath -Raw

$modVersion = ([string]$publish.Publish.ModVersion.Value).Trim()
$projectVersion = $project.SelectSingleNode('/Project/PropertyGroup/Version').InnerText.Trim()
$assemblyVersion = [version]$project.SelectSingleNode('/Project/PropertyGroup/AssemblyVersion').InnerText.Trim()
$assemblyName = $project.SelectSingleNode('/Project/PropertyGroup/AssemblyName').InnerText.Trim()
$bridgeSource = Get-Content -LiteralPath (Join-Path $projectRoot 'src\Core\GameQueryService.cs') -Raw
if (!$bridgeSource.Contains('["bridge_version"] = typeof(Mod).Assembly.GetName().Version.ToString(3)')) {
    throw 'The bridge version no longer uses the mod assembly; review its version source before publishing.'
}
$bridgeVersion = $assemblyVersion.ToString(3)
if ($modVersion -ne $projectVersion -or $modVersion -ne $bridgeVersion) {
    throw "Version mismatch: publish=$modVersion, project=$projectVersion, bridge=$bridgeVersion"
}

$shortDescription = [string]$publish.Publish.ShortDescription.Value
$longDescription = [string]$publish.SelectSingleNode('/Publish/LongDescription').InnerText
if ([string]::IsNullOrWhiteSpace($shortDescription) -or
    [string]::IsNullOrWhiteSpace($longDescription) -or
    $shortDescription -match 'short description' -or
    $longDescription -match 'long description') {
    throw 'Replace the placeholder Paradox Mods descriptions before publishing.'
}
if ([string]$publish.Publish.GameVersion.Value -eq '1.0.*') {
    throw 'The supported game version is still the template placeholder.'
}
$expectedCommand = if ($UpdateVersion) { 'NewVersion' } else { 'Publish' }
if ([string]$profile.Project.PropertyGroup.ModPublisherCommand -ne $expectedCommand) {
    throw "$profileName does not select the $expectedCommand command."
}
if ($UpdateVersion -and [string]::IsNullOrWhiteSpace([string]$publish.Publish.ModId.Value)) {
    throw 'An existing Paradox Mods ModId is required for NewVersion.'
}

$thumbnailPath = Join-Path $projectRoot ([string]$publish.Publish.Thumbnail.Value)
if (!(Test-Path -LiteralPath $thumbnailPath -PathType Leaf) -or (Get-Item -LiteralPath $thumbnailPath).Length -eq 0) {
    throw "A nonempty thumbnail is required: $thumbnailPath"
}

if ($RequireStagedBuild) {
    $stagedDll = Join-Path $projectRoot ('artifacts\staged\' + $assemblyName + '\' + $assemblyName + '.dll')
    if (!(Test-Path -LiteralPath $stagedDll -PathType Leaf)) {
        throw 'The staged mod DLL is missing. Run ./build.ps1 -Configuration Release -Stage first.'
    }
    $stagedVersion = (Get-Item -LiteralPath $stagedDll).VersionInfo.ProductVersion
    $stagedAssembly = [Reflection.AssemblyName]::GetAssemblyName($stagedDll)
    if ($stagedAssembly.Name -ne $assemblyName -or $stagedAssembly.Version.ToString(3) -ne $modVersion) {
        throw 'The staged bridge assembly identity does not match the current project.'
    }
    if ($stagedVersion -and $stagedVersion -ne $modVersion -and !$stagedVersion.StartsWith($modVersion + '+')) {
        throw "Staged DLL version $stagedVersion does not match publish version $modVersion. Rebuild first."
    }
}

Write-Output "Paradox Mods metadata ready for review: CityWeaver $modVersion, game $($publish.Publish.GameVersion.Value), access $($publish.Publish.AccessLevel.Value)."
Write-Output 'This check does not publish the mod or bundle the separate Node.js MCP server.'
