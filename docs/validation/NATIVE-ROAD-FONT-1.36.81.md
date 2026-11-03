# Map recovery and saved native font projectors

Recovery verified in sessionfe3569743b92484fbd99258c0bfb18c7: bridge1.36.79, editor_ready/map_loaded true, loading false. No recurring GeometryAssetLoadingSystem header exception. NativeRoadFont generated assets from1.36.80 are quarantined in the failed-version backup. Save files unchanged.

1.36.80 registered live GeometryAssets during MainLoop map load. Native asynchronous GeometryAssetLoadingSystem then repeatedly threw "GeometryData header should only have to be read once!", blocking loading. Headless crop tests/build did not validate this asset lifecycle; visual/loading verification had not passed.

1.36.81 removes live geometry creation entirely from NativeRoadFont.Create. Projector volumes are pre-imported through preview_model_import/apply_asset_file_operation while the stable editor is already loaded, then saved by the native pipeline. Narrow projector is3*68/512m wide; wide projector3*121/512m; both1m high,6m deep,12 cube triangles. Exported native zero normals were omitted so ObjMeshRules generates proper normals (the first invalid preview was rejected and no import committed).

Both imports completed with native bounds verification, no placement: narrow CityWeaver_b6757c4c951f4678b0bcc0042fa5da90; wide CityWeaver_14ef49d3f54741a2b8c02f7345320f09. The runtime clones native decal RenderPrefabs and reuses only the saved geometry reference/metadata; original atlas, material, shader and native glyph crops are unchanged. No model buffers, mesh loading or GeometryAsset writes occur in this font registration path.

Formal staged1.36.81 zero warnings/errors;4 regressions passed: native crop/proportion, saved projector topology/bounds and no live GeometryAsset creation, speed/readiness, editor access. Installed version remains1.36.79. Pending deployment: actual map loading, native glyph appearance,160/200 matching and reload stability. The new version is not yet live-validated.

Evidence: artifacts/recovery-1.36.80-to-1.36.79/completed.json, font81-narrow/wide-result.json, build-1.36.81.log, tests-1.36.81.log. Map remains paused/default tool, no save or permanent geometry changes.

## Live result

Session2eb6522b195d43168e50302c91226f4b successfully loaded editor map on1.36.81. Native glyph registration and3-part160/200 initialization completed. Player.log contains zero geometry-header/loading critical errors; CityWeaver.Mod.log zeroERROR records in this session.

Screenshot font81-live.png clearly displays white160 using original font. Changed the visible southern approach edge56843 from160 to200 through preview/build; font81-live200.png displays200 in original font, lane readback200. Restored all car lanes to160; font81-restored160.png displays160 again. Geometry Curve and PrefabRef match pre-test snapshot exactly. No roads constructed or removed, no automatic save. Both roots have3 native glyph projectors;160 materials are all original DefaultDecal/BH/Decals/DefaultDecalShader.

font81-final-verification.json records this pass. Native-font appearance and the previous load failure are verified in the running game. A subsequent save/reload after writing1.36.81 objects has not been separately tested. Game left paused, current twelve-lane approach160; highway catalog default200.
