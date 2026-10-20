package com.mobilecodex.app;
import java.io.*;
import java.nio.file.*;
class HotUpdatePathsTest {
 public static void main(String[] args) throws Exception {
  Path temp=Files.createTempDirectory("hot-path-test-"); File root=Files.createDirectory(temp.resolve("root")).toFile();
  for(String name:new String[]{".","..","../escape","a/b","a\\b","",".hidden"}) {
   if(HotUpdatePaths.isSafeVersion(name)) throw new AssertionError("unsafe version: "+name);
   try {HotUpdatePaths.bundle(root,name);throw new AssertionError("accepted: "+name);} catch(IllegalArgumentException expected){}
  }
  File good=HotUpdatePaths.bundle(root,"v1.2-3_test"); if(!good.mkdir())throw new AssertionError();
  Files.writeString(good.toPath().resolve("index.html"),"ok");
  HotUpdatePaths.deleteTree(root,good); if(good.exists())throw new AssertionError();
  try {HotUpdatePaths.deleteTree(root,root);throw new AssertionError();}catch(IllegalArgumentException expected){}
  Path outside=Files.createDirectory(temp.resolve("outside")); Files.writeString(outside.resolve("keep"),"keep");
  Path link=root.toPath().resolve("evil"); Files.createSymbolicLink(link,outside);
  try {HotUpdatePaths.bundle(root,"evil");throw new AssertionError();}catch(IllegalArgumentException expected){}
  try {HotUpdatePaths.deleteTree(root,link.toFile());throw new AssertionError();}catch(IllegalArgumentException expected){}
  if(!Files.exists(outside.resolve("keep")))throw new AssertionError();
  Files.delete(link); Files.delete(outside.resolve("keep"));Files.delete(outside);Files.delete(root.toPath());Files.delete(temp);
  System.out.println("HotUpdatePaths: version, containment, symlink and deletion checks passed");
 }
}
