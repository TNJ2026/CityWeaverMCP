# New map perimeter water and40m depth

Session548466b252554f96b6a60cc4c8e66e50, editor1.36.81. Initial map uniformly511.9453m, zero water sources. Created a closed perimeter basin along x/z±6900 with1000m brush,8level passes; preserved central land.32constant-depth sources, radius250m, multiplier.1, pollution0. Global water.SeaLevel501.9453m retains10m offset below central plateau.

User clarified "−40m" means40m below current water surface, not absolute elevation. Relevelled perimeter to461.9453m; measured461.94455m. Sources use ground Y461.94455 and depth40.00075 so target surface remains501.9453m. Source transform must use ground elevation; assigning water-surface Y adds the depth twice. Initial source positioning was corrected before final verification.

Four cardinal-side128m sample patches read surface501.944824m and depth40.00026..40.00029m. Full3136-cell mask contains636deep-water cells and zero wet cells within abs(x/z)<6300m. Central sampled heights remain511.9453m. Residual waves away from source centers range501.2566..502.601135m and can continue settling when simulation runs; target sea/source settings unchanged.

Game left paused/default tool, no automatic save. Evidence: ring40-terrain-result.json, ring40-terrain-samples.json, ring40-source-updates.json, ring40-four-sides.json, ring40-final-water.json, ring40-final-sources.json; new-ring-* contains initial ring construction.
