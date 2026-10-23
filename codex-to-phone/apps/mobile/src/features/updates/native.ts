import { registerPlugin } from "@capacitor/core";
import { type HotUpdatePlugin } from "../../app/types";
import { type ApkUpdatePlugin } from "./apk";

export const NativeHotUpdate = registerPlugin<HotUpdatePlugin>("HotUpdate");
export const NativeApkUpdate = registerPlugin<ApkUpdatePlugin>("ApkUpdate");
