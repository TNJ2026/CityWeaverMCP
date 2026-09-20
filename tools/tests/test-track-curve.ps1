$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../../src/Transport/TrackCurveGeometry.cs')
$radius = [CityWeaver.TrackCurveGeometry]::SampledMinimumRadius(0,0,82.842712,0,150,67.157288,150,150)
if ($radius -lt 148 -or $radius -gt 151) { throw "Quarter-circle radius failed: $radius" }
$tight = [CityWeaver.TrackCurveGeometry]::SampledMinimumRadius(0,0,8.2842712,0,15,6.7157288,15,15)
if ([Math]::Abs($tight * 10 - $radius) -gt .001) { throw 'Radius scale invariance failed' }
if ([CityWeaver.TrackCurveGeometry]::SampledMinimumRadius(0,0,0,0,1,1,2,2) -ne 0) { throw 'Degenerate curve accepted' }
if (-not [double]::IsPositiveInfinity([CityWeaver.TrackCurveGeometry]::SampledMinimumRadius(0,0,50,0,100,0,150,0))) { throw 'Straight radius failed' }
Write-Output 'Track curve geometry checks passed.'
