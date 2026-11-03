# 1.36.78 live failure and 1.36.79 material diagnostics

Session67ee695f17a045b2a10f25edc4ebc945, editor1.36.78. Native stencil320/400 and SubMesh initialization pass; catalog200/160 and four sampled twelve-lane edges160 pass. User zoomed current northern approach. speed78-live-close160.png still shows blue checker-like digits. Visual validation failed, not a completed fix.

White source PNG is8x8 RGBA(255,255,255,255). Same-white preview_texture_replacement applied successfully with GPU load verification; screenshot unchanged. Test override490d8011aca24da387d7521b040145e2 restored. Therefore replacing base color alone is insufficient; missing full material data, surface shader and geometry overlay settings remain candidates. No definitive root cause claim.

1.36.79 adds owned-only RoadMarkingMaterialProfile. On registration it supplies real64x64 base-color, mask and normal textures, an explicit native DefaultDoubleSided template, white base color, zero metallic and .15 smoothness, .08m mesh offset. No stock materials modified. Generated textures saved and GPU sample-format checked. list_asset_materials now reports material template/hash/shader.

Live tuning file: C:/Users/sc/AppData/LocalLow/Colossal Order/Cities Skylines II/ModsData/CityWeaver/RoadMarkingMaterial.json. Created with defaults only if absent, checked once per second. Edit material_template (Default, DefaultDoubleSided, DefaultDecal), base_color/mask/normal RGBA0..1 and offset_m0..1. Successful changes rebuild only two owned stencil materials/prefabs, remove stale pool references and request native decoration refresh. Allows adjusting after deployment without another DLL update. Errors logged, retry backs off10s. No guarantee that the first profile fixes the observed rendering; verify screenshots before completion.

Formal staged1.36.79 zero warnings/errors. Three related regressions passed: speed/readiness, geometry/normal/orientation, editor access. New live profile/GPU rendering remains pending deployment. Game paused/default tool; no road geometry changed or automatic map save. Temporary texture override restored and native previews cleaned up.
