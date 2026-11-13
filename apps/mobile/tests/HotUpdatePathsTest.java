package com.mobilecodex.app;
import java.io.*;
import java.nio.file.*;
class HotUpdatePathsTest {
 public static void main(String[] args) throws Exception {
  Path temp=Files.createTempDirectory("hot-path-test-"); File root=Files.createDirectory(temp.resolve("root")).toFile().getCanonicalFile();
  for(String name:new String[]{".","..","../escape","a/b","a\\b","",".hidden"}) {
   if(HotUpdatePaths.isSafeVersion(name)) throw new AssertionError("unsafe version: "+name);
   try {HotUpdatePaths.bundle(root,name);throw new AssertionError("accepted: "+name);} catch(IllegalArgumentException expected){}
  }
  File good=HotUpdatePaths.bundle(root,"v1.2-3_test"); if(!good.mkdir())throw new AssertionError();
  Files.writeString(good.toPath().resolve("index.html"),"ok");
  HotUpdatePaths.deleteTree(root,good); if(good.exists())throw new AssertionError();
  try {HotUpdatePaths.deleteTree(root,root);throw new AssertionError();}catch(IllegalArgumentException expected){}
  try {HotUpdatePaths.deleteTree(root,temp.toFile());throw new AssertionError();}catch(IllegalArgumentException expected){}
  Path sibling=Files.createDirectory(temp.resolve("root-other")); Files.writeString(sibling.resolve("keep"),"keep");
  try {HotUpdatePaths.deleteTree(root,sibling.resolve("keep").toFile());throw new AssertionError();}catch(IllegalArgumentException expected){}
  if(!Files.exists(sibling.resolve("keep")))throw new AssertionError("deleted sibling with matching prefix");
  Path nested=Files.createDirectories(root.toPath().resolve("nested/deep")); Files.writeString(nested.resolve("index.html"),"ok");
  HotUpdatePaths.deleteTree(root,root.toPath().resolve("nested").toFile());
  if(Files.exists(nested))throw new AssertionError("nested tree survived cleanup");
  Path target=Files.createDirectory(root.toPath().resolve("target")); Files.writeString(target.resolve("keep"),"keep");
  Path internalLink=root.toPath().resolve("internal-link"); Files.createSymbolicLink(internalLink,target);
  HotUpdatePaths.deleteTree(root,internalLink.toFile());
  if(Files.exists(internalLink,LinkOption.NOFOLLOW_LINKS)||!Files.exists(target.resolve("keep")))throw new AssertionError("followed internal symlink");
  HotUpdatePaths.deleteTree(root,target.toFile());
  Path outside=Files.createDirectory(temp.resolve("outside")); Files.writeString(outside.resolve("keep"),"keep");
  Path link=root.toPath().resolve("evil"); Files.createSymbolicLink(link,outside);
  try {HotUpdatePaths.bundle(root,"evil");throw new AssertionError();}catch(IllegalArgumentException expected){}
  try {HotUpdatePaths.deleteTree(root,link.toFile());throw new AssertionError();}catch(IllegalArgumentException expected){}
  if(!Files.exists(outside.resolve("keep")))throw new AssertionError();
  Files.delete(link); Files.delete(outside.resolve("keep"));Files.delete(outside);Files.delete(sibling.resolve("keep"));Files.delete(sibling);Files.delete(root.toPath());Files.delete(temp);
  System.out.println("HotUpdatePaths: version, containment, symlink and deletion checks passed");
 }
}
