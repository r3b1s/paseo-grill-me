import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerGrill } from "./server/grill";

export default function contribute(server: PluginServerContext) {
  return registerGrill(server);
}
