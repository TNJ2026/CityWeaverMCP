# Editor map save/reload loses ring speed override

Controlled test on1.36.81:

1. Editor session607a0616e44244c88f1598d061e8ce84: rediscovered all4 central No Pedestrians ring edges; initial actual limits20. Applied100 through native preview_road_policies/build_road and verified every car-lane record100. Baseline written before requesting user save/reload.
2. User confirmed saving as a test map copy and reloading that copy in editor. New sessionc2919a1c8d33494fa12ef49cc94683e6: all4 central ring edges actual speed20 and default20. No new city was required to reproduce the loss.

This proves the override does not survive the editor map save/reload lifecycle. The test alone does not distinguish serialization omission from native lane regeneration during reload. Current implementation writes CarLane runtime values; a persistent override store and reapply after rebuild, or deliberate prefab default migration, needs implementation. No fix deployed in this verification step.

Current map left paused with reproduced20 values unchanged. Evidence: ring-persistence-editor-before.json, ring-persistence-editor-baseline100.json, ring-persistence-test100 operation results, ring-persistence-editor-reloaded.json.
