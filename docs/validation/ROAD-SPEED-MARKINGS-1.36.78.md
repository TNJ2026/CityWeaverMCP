# 1.36.77 live verification and material follow-up

Session2e42cbf25afd4b2f86e062b76011351e, editor1.36.77. Stencil160 native data320/typeMask1024, one initialized SubMesh, size2.24x0.02x3.6. Native selection on western approach uses custom prefab48687; initialization fix passed. Screenshot speed77-before.png shows blue-grey digits, so visual160/200 validation is not complete.

Root cause: original OBJ importer explicitly ignores MTL colors. Old imported stencil surfaces have no textures (speed77-materials.json). Reimport supplies native-named CWLimit160/200_BaseColorMap.png, both references verified in speed78-final160/200-materials.json. No stock surface was modified. New stable sources: CityWeaver_7234af88a3ba4bd88f0ae66b242e3302 and CityWeaver_88b840c0291f4cc3bb954dccb99f59cf. Registry now refuses models missing real base color texture.

Geometry Z is pre-reflected in OBJ to compensate native import conversion and keep the top of digits aligned with native stencil rotation. Winding reversed to retain upward faces. Actual ObjMeshRules regression checks all triangle fronts and normals, 6 upper-right gap/lower-right stroke and 2 opposite stroke placement. White source image is copied from existing owned white texture into assets/road-markings/WhiteBaseColor.png and generated groups.

White model was tested in a temporary editor preview on grass; preview highlighting prevents asserting final material appearance. Preview cancelled, no permanent object placed. Earlier overlapping-road preview rejected by native validation and not committed. Need deployed final source binding and actual road screenshots to confirm white readable160/200.

Formal staged1.36.78 build zero warnings/errors; three regression tests passed (units/readiness, geometry, editor access). Native import complete/bounds verified for both final models. Game paused/default tool; no map geometry changed or automatic save.
