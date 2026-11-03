# Restore native road numeral style

User requests original road font after1.36.79. That build renders white stencil geometry, but its seven-segment glyphs differ from stock. No native-font visual pass claimed yet.

Read-only MCP export confirms EU LaneMarkings Speed100/60 use the same original LaneMarkingsEUNA atlas (4096x4096), DefaultDecal template18, BH/Decals/DefaultDecalShader, original base/mask/normal maps and a3x1x6m cube projector. These are actual decal numerals, not an installed system font.

1.36.80 clones native RenderPrefab donors100/120/60. Glyph1/0 come from100,2 from120,6 from60. Alpha column bounds measured from exported native atlas are in artifacts/native-road-font/glyph-runs.json. Each crop has2px transparent padding; projector width scales in proportion to UV width, retaining the narrow1 and native numeral aspect. Original atlas, textures, decal shader, material and vertical mapping are reused without pixel edits. Native cube geometry is narrowed and saved as separate owned GeometryAsset. No dependency on seven-segment imports remains for active160/200 stencils.

Stable roots CityWeaver LaneMarkings Speed160/200 retain native limits320/400 and now contain3 glyph projectors each. Registry remains before PrefabSystem and checks initialized sign data, render parts, bounds and archetype before candidate admission. Existing roads refresh decorations only.

Live layout tuning: ModsData/CityWeaver/RoadMarkingFont.json (rotation_degrees, reverse_digits, spacing_m, offset_m), checked once per second. Defaults use native144px/512px*3m=.84375m pitch, original orientation and height. Native material atlas remains shared read-only; the previous procedural material profile does not apply to new native glyphs.

Formal staged1.36.80 zero warnings/errors. Three related regressions passed: native alpha crop/proportions including narrow1 and rejecting incompatible atlas bounds, speed/readiness, editor access. Pending game verification of actual160/200 readability and layout. Current session73ccede838e442ec82c7a74ff27a43bc remains paused/default tool, no automatic save or map geometry edits.

Evidence: native-font100/60-materials.json; native-font-atlas-export.json and exported manifest; build-1.36.80.log; tests-1.36.80.log.
