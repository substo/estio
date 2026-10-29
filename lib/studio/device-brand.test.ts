import test from "node:test";
import assert from "node:assert/strict";
import { getHostBrandConfig, getHostOrigin, resolveHostBrand } from "@/lib/auth/host-brand";
import { studioDeviceBrand } from "./device-brand";
const config = getHostBrandConfig({ SUBSTO_APP_HOSTS: "substo.com" } as NodeJS.ProcessEnv);
const brandFor = (host: string) => studioDeviceBrand(resolveHostBrand(host, config), getHostOrigin(host));
test("Studio device brand follows the host", () => {
  assert.deepEqual(brandFor("estio.co"), { app: "estio", name: "Estio", iconUrl: "https://estio.co/images/estio%20favicon/android-chrome-192x192.png" });
  assert.deepEqual(brandFor("substo.com"), { app: "substo", name: "Substo", iconUrl: "https://substo.com/images/substo-mark.svg" });
  assert.equal(brandFor("downtowncyprus.site"), null);
  assert.equal(studioDeviceBrand("estio", null), null);
});
