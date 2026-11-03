import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';
test('persistent route texture cache reuses bytes across operation/reload and separates sampling, alpha and colour space',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cw-route-cache-'));
 try{
  const files=['RouteColorCacheRules','VehicleRouteColorCache'].map(n=>fileURLToPath(new URL('../../src/Editor/'+n+'.cs',import.meta.url)));
  await writeFile(path.join(dir,'Test.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><AllowUnsafeBlocks>true</AllowUnsafeBlocks></PropertyGroup><ItemGroup>${files.map(p=>`<Compile Include="${p}"/>`).join('')}</ItemGroup></Project>`);
  await writeFile(path.join(dir,'Program.cs'),`using System;using System.IO;using System.Collections.Generic;using System.Runtime.InteropServices;using CityWeaver;using UnityEngine;using Colossal.IO.AssetDatabase;
namespace UnityEngine{
 [StructLayout(LayoutKind.Sequential,Pack=1)]public struct Color32{public byte r,g,b,a;public Color32(byte r,byte g,byte b,byte a){this.r=r;this.g=g;this.b=b;this.a=a;}}
 public enum TextureWrapMode{Repeat,Clamp}public enum FilterMode{Point,Bilinear,Trilinear}public enum TextureFormat{RGBA32}
 public class Texture2D{public static int Allocations;public int width,height,anisoLevel;public bool linear;public TextureWrapMode wrapMode;public FilterMode filterMode;public Color32[] Pixels;public Texture2D(int w,int h,TextureFormat f,bool m,bool l){width=w;height=h;linear=l;Allocations++;}public void SetPixels32(Color32[] p){Pixels=(Color32[])p.Clone();}public void Apply(bool a,bool b){}}
 public class Object{public static void Destroy(object o){}}
}
namespace Colossal.AssetPipeline.Importers{public class TextureImporter{public interface ITexture{Texture2D Image{get;}}public class Texture:ITexture,IDisposable{public Texture2D Image{get;}public Texture(string n,object o,Texture2D i){Image=i;}public void ComputeMips(bool a,bool b){}public void Dispose(){}}}}
namespace Colossal.IO.AssetDatabase{
 public class AssetDataPath{public string Key;public static AssetDataPath Create(string p,string n)=>new AssetDataPath{Key=p+"/"+n};}
 public class TextureAsset{public int width,height;public bool Saved;public UnityEngine.Texture2D Image;public void Save(){Saved=true;}}
 public static class AssetDatabase{public static Database user=new Database();}
 public class Database{public Dictionary<string,TextureAsset> Disk=new Dictionary<string,TextureAsset>();public int Writes;public bool Exists<T>(AssetDataPath p,out T value){bool found=Disk.TryGetValue(p.Key,out var a);value=found?(T)(object)a:default;return found;}public T AddAsset<T,D>(AssetDataPath p,D value)where D:Colossal.AssetPipeline.Importers.TextureImporter.ITexture{if(Disk.ContainsKey(p.Key))throw new Exception("Cache overwrite");var i=value.Image;var a=new TextureAsset{width=i.width,height=i.height,Image=i};Disk[p.Key]=a;Writes++;return(T)(object)a;}}
}
namespace CityWeaver{
 internal class VehicleModelOperation{public int RouteCacheHits,RouteCacheWrites;}
 internal class VehicleRouteColorMask{public int Width=4,Height=4;public byte[] Weights;public Color32[] NeutralBase;public TextureWrapMode Wrap;public FilterMode Filter=FilterMode.Bilinear;}
 public sealed partial class GameQueryService{private static void ValidateSavedTexture(TextureAsset a){if(!a.Saved)throw new Exception("Incomplete cache entry");}internal static TextureAsset Get(VehicleModelOperation o,VehicleRouteColorMask m,bool b)=>CachedRouteTexture(o,m,b);}
}
class Program{
 static void Check(bool b){if(!b)throw new Exception("Cache invariant failed");}static void Reject(Action f){try{f();}catch(ArgumentException){return;}throw new Exception("Invalid content admitted");}
 static void Main(){
  var m=new VehicleRouteColorMask{Width=2,Height=2,Weights=new byte[]{0,1,127,255}};var a=new VehicleModelOperation();var first=GameQueryService.Get(a,m,false);Check(a.RouteCacheWrites==1&&a.RouteCacheHits==0);int allocations=Texture2D.Allocations;
  // Reconstruct an operation as persistence does after load: user database survives.
  var b=new VehicleModelOperation();Check(ReferenceEquals(first,GameQueryService.Get(b,m,false)));Check(b.RouteCacheHits==1&&b.RouteCacheWrites==0&&Texture2D.Allocations==allocations);
  Check(first.Image.Pixels[3].r==255&&first.Image.Pixels[3].g==0&&first.Image.Pixels[3].a==0&&first.Image.linear);
  m.Wrap=TextureWrapMode.Clamp;Check(!ReferenceEquals(first,GameQueryService.Get(b,m,false)));m.Wrap=TextureWrapMode.Repeat;
  m.Filter=FilterMode.Point;Check(!ReferenceEquals(first,GameQueryService.Get(b,m,false)));m.Filter=FilterMode.Bilinear;
  m.Weights[0]=2;Check(!ReferenceEquals(first,GameQueryService.Get(b,m,false)));m.Weights[0]=0;
  m.NeutralBase=new[]{new Color32(1,2,3,4),new Color32(5,6,7,8),new Color32(9,10,11,12),new Color32(13,14,15,16)};
  var base1=GameQueryService.Get(b,m,true);Check(!base1.Image.linear&&base1.Image.Pixels[0].a==4);Check(ReferenceEquals(base1,GameQueryService.Get(new VehicleModelOperation(),m,true)));
  m.NeutralBase[0].a=5;Check(!ReferenceEquals(base1,GameQueryService.Get(b,m,true)));
  var zero=new VehicleRouteColorMask();var z=GameQueryService.Get(b,zero,false);Check(ReferenceEquals(z,GameQueryService.Get(new VehicleModelOperation(),new VehicleRouteColorMask(),false)));
  string Key(bool linear,int w,int h)=>RouteColorCacheRules.Key(w,h,linear,0,1,false,new MemoryStream(new byte[4]));Check(Key(true,2,2)!=Key(false,2,2));Check(Key(true,1,4)!=Key(true,2,2));
  Reject(()=>RouteColorCacheRules.Key(2,2,true,0,1,false,new MemoryStream(new byte[3])));Reject(()=>RouteColorCacheRules.Key(0,2,true,0,1,false,new MemoryStream()));
  int writes=AssetDatabase.user.Writes;first.width=99;try{GameQueryService.Get(new VehicleModelOperation(),m,false);throw new Exception("Corrupt cache accepted");}catch(InvalidOperationException){}Check(AssetDatabase.user.Writes==writes);
  Console.WriteLine("Persistent route colour cache verified");
 }
}`);
  assert.match(execFileSync('dotnet',['run','--project',path.join(dir,'Test.csproj')],{encoding:'utf8',timeout:120000}),/Persistent route colour cache verified/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
