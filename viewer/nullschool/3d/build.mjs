import { build } from "esbuild";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
await build({
  entryPoints: ["vendor-entry.js"],
  outfile: "vendor.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
const notices = [];
for (const name of ["three", "3d-tiles-renderer"]) {
  for (const file of ["LICENSE", "LICENSE.md"]) {
    try {
      notices.push(
        name + "\n" + (await readFile(`node_modules/${name}/${file}`, "utf8")),
      );
      break;
    } catch {}
  }
}
await writeFile("THIRD-PARTY-NOTICES.txt", notices.join("\n\n"));
await mkdir("decoders/draco", { recursive: true });
for (const file of [
  "draco_wasm_wrapper.js",
  "draco_decoder.wasm",
  "draco_decoder.js",
]) {
  await copyFile(
    `node_modules/three/examples/jsm/libs/draco/gltf/${file}`,
    `decoders/draco/${file}`,
  );
}
for (const name of ["draco", "meshoptimizer"]) {
  notices.push(name + "\n" + (await readFile(`licenses/${name}.txt`, "utf8")));
}
await writeFile("THIRD-PARTY-NOTICES.txt", notices.join("\n\n"));
