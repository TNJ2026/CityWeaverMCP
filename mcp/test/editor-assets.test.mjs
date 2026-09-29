import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('editor asset commit gates, bounded coordinates and polygon geometry reject unsafe requests',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cityweaver-editor-assets-'));
  try {
    const rules=fileURLToPath(new URL('../../src/Editor/EditorAssetRules.cs',import.meta.url));
    const access=fileURLToPath(new URL('../../src/Editor/EditorAccessPolicy.cs',import.meta.url));
    await writeFile(path.join(dir,'Test.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${rules}"/><Compile Include="${access}"/></ItemGroup></Project>`);
    await writeFile(path.join(dir,'Program.cs'),`using System;using CityWeaver;
class Program {
 static void Check(bool b,string s){if(!b)throw new Exception(s);}
 static void Main(){
  var now=DateTime.UtcNow;
  Check(EditorAssetRules.PlacementHeight(512,512,0,1000,true,false,false)==1512,"Air connection lost native hovering offset");
  Check(EditorAssetRules.PlacementHeight(462,512,50,1000,true,false,false)==1512,"Air connection incorrectly based on seabed");
  Check(EditorAssetRules.PlacementHeight(462,512,50,4,false,true,false)==516,"Floating height wrong");
  Check(EditorAssetRules.PlacementHeight(512,512,0,4,false,true,false)==512,"Dry floating asset elevated incorrectly");
  Check(EditorAssetRules.PlacementHeight(512,512,0,4,false,false,false)==516,"Ground offset lost");
  Check(EditorAssetRules.CanCommit("preview_ready",false,now.AddMinutes(1),now,0,0,0,0),"Free editor preview should commit");
  foreach(var state in new[]{"queued","generating_preview","applying","completed","failed","cancelled","expired","outcome_unknown",null})
   Check(!EditorAssetRules.CanCommit(state,false,now.AddMinutes(1),now,0,0,0,0),"Invalid state committed");
  Check(!EditorAssetRules.CanCommit("preview_ready",true,now.AddMinutes(1),now,0,0,0,0),"Cancelled commit");
  Check(!EditorAssetRules.CanCommit("preview_ready",false,now,now,0,0,0,0),"Expired commit");
  Check(!EditorAssetRules.CanCommit("preview_ready",false,now.AddMinutes(1),now,1,0,0,0),"Cost ceiling ignored");
  Check(!EditorAssetRules.CanCommit("preview_ready",false,now.AddMinutes(1),now,0,0,1,0),"Error ignored");
  Check(!EditorAssetRules.CanCommit("preview_ready",false,now.AddMinutes(1),now,0,0,0,1),"Warning ignored");
  foreach(var v in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity,100001.0,-100001.0})Check(!EditorAssetRules.Coordinate(v),"Bad coordinate accepted");
  Check(EditorAssetRules.Coordinate(-14336)&&EditorAssetRules.Coordinate(14336),"World boundary rejected");
  Check(EditorAssetRules.SimplePolygon(new[]{0d,100,100,0},new[]{0d,0,100,100}),"Square rejected");
  Check(EditorAssetRules.SimplePolygon(new[]{0d,0,100,100},new[]{0d,100,100,0}),"Reverse winding rejected");
  Check(EditorAssetRules.SimplePolygon(new[]{0d,100,50,100,0},new[]{0d,0,50,100,100}),"Simple concave polygon rejected");
  Check(!EditorAssetRules.SimplePolygon(new[]{0d,100,0,100},new[]{0d,100,100,0}),"Bow tie accepted");
  Check(!EditorAssetRules.SimplePolygon(new[]{0d,100,100,0,0},new[]{0d,0,100,100,0}),"Repeated closing vertex accepted");
  Check(!EditorAssetRules.SimplePolygon(new[]{0d,1,2},new[]{0d,0,0}),"Collinear polygon accepted");
  Check(!EditorAssetRules.SimplePolygon(new[]{0d,100,double.NaN},new[]{0d,0,100}),"NaN polygon accepted");
  Check(!EditorAssetRules.SimplePolygon(new double[129],new double[129]),"Oversized polygon accepted");
  foreach(var tool in new[]{"list_editor_assets","get_editor_asset","select_editor_asset","preview_editor_asset","get_editor_asset_operation","apply_editor_asset","cancel_editor_asset_preview"})Check(EditorAccessPolicy.Allows(tool),"Incomplete asset lifecycle");
  foreach(var tool in new[]{"set_city_money","unlock_all_progression","save_game","unknown_asset_write"})Check(!EditorAccessPolicy.Allows(tool),"City/unknown write leaked");
  Check(EditorAssetRules.Terminal("outcome_unknown"),"Unknown outcome must stop retries");
  Console.WriteLine("asset transaction and geometry boundaries verified");
 }
}`);
    assert.match(execFileSync('dotnet',['run','--project',path.join(dir,'Test.csproj')],{encoding:'utf8',timeout:120000}),/asset transaction and geometry boundaries verified/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
