import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('editor access is bounded and resource brushes never select partially outside cells', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-editor-'));
  try {
    const source = fileURLToPath(new URL('../../src/Editor/EditorAccessPolicy.cs', import.meta.url));
    await writeFile(path.join(dir, 'Test.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}" /></ItemGroup></Project>`);
    await writeFile(path.join(dir, 'Program.cs'), `using System; using CityWeaver;
class Program {
  static void Main() {
    foreach(var tool in new[]{"preview_terrain","apply_terrain","create_water_source","place_landscape_objects","preview_map_resources","capture_game_view","get_editor_state","get_editor_configuration","preview_editor_configuration","apply_editor_configuration","list_editor_environment_presets","preview_editor_environment"})
      if(!EditorAccessPolicy.Allows(tool)) throw new Exception("Required editor domain unavailable");
    foreach(var tool in new[]{"set_city_money","unlock_all_map_tiles","preview_road_upgrade","preview_road_grid","preview_road_elevation","preview_road_policies","set_resource_amount","save_game","unknown",null})
      if(EditorAccessPolicy.Allows(tool)) throw new Exception("City-only or unknown mutation escaped editor gate");
    foreach(var resource in new[]{"fish","forest","coal","Ore",null})
      if(EditorAccessPolicy.IsResource(resource)) throw new Exception("Unsupported resource layer accepted");
    foreach(var tool in new[]{"list_waterway_prefabs","list_waterways","get_waterway","preview_waterway","preview_waterway_delete","get_waterway_operation","apply_waterway_operation","cancel_waterway_preview"})
      if(!EditorAccessPolicy.Allows(tool)) throw new Exception("Editor waterway lifecycle incomplete");
    if(!EditorAccessPolicy.EditorWaterway(true,"waterway")) throw new Exception("Editor waterway policy missing");
    foreach(var kind in new[]{"road","transport_track","utility_network","pier_pathway",null,"Waterway"})
      if(EditorAccessPolicy.EditorWaterway(true,kind)) throw new Exception("Unrelated editor network escaped city gates");
    if(EditorAccessPolicy.EditorWaterway(false,"waterway")) throw new Exception("City waterway bypassed economy/progression");
    foreach(var tool in new[]{"list_road_prefabs","find_roads_by_name","inspect_road_lanes","preview_road","preview_road_route","preview_road_ring","get_road_operation","build_road","cancel_road_preview"})
      if(!EditorAccessPolicy.Allows(tool)) throw new Exception("Editor road lifecycle incomplete");
    foreach(bool editor in new[]{false,true})
    foreach(var kind in new string[]{null,"waterway","road","transport_track","utility_network","pier_pathway","direct_atomic","native_asset_stamp"})
    foreach(var op in new string[]{null,"create","upgrade","demolish","road_policies","terrain_elevation"}) {
      bool expected=editor && (kind=="waterway" || (kind==null && op=="create"));
      if(EditorAccessPolicy.EditorNetwork(editor,kind,op)!=expected) throw new Exception("Network lifecycle escaped mode/domain boundary");
    }
    if(!EditorAccessPolicy.ContainsCell(0,0,0,0,28,28,40)) throw new Exception("Contained cell excluded");
    if(EditorAccessPolicy.ContainsCell(25,0,0,0,28,28,56)) throw new Exception("Partially covered cell included");
    int selected=0;
    for(int z=0;z<256;z++) for(int x=0;x<256;x++) {
      double px=-7168+(x+.5)*56, pz=-7168+(z+.5)*56;
      if(!EditorAccessPolicy.ContainsCell(px,pz,123,-321,28,28,500)) continue;
      selected++;
      foreach(int sx in new[]{-1,1}) foreach(int sz in new[]{-1,1}) {
        double dx=px+sx*28-123, dz=pz+sz*28+321;
        if(dx*dx+dz*dz>500*500) throw new Exception("Brush selected an outside corner");
      }
    }
    if(selected==0) throw new Exception("Empty realistic selection");
    Console.WriteLine("editor domains and bounded resource cells verified");
  }
}`);
    assert.match(execFileSync('dotnet', ['run','--project',path.join(dir,'Test.csproj')], {encoding:'utf8',timeout:120000}), /editor domains and bounded resource cells verified/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
