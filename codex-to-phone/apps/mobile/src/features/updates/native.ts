import { registerPlugin } from "@capacitor/core";
import { type HotUpdatePlugin } from "../../app/types";

export const NativeHotUpdate = registerPlugin<HotUpdatePlugin>("HotUpdate");
