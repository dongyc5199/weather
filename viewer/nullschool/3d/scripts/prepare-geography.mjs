import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Pin the source so a rebuild does not silently change river or boundary geometry.
const revision = "ca96624a56bd078437bca8184e78163e5039ad19";
const root = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/`;
const files = [
  "ne_50m_admin_0_boundary_lines_land.geojson",
  "ne_110m_admin_0_boundary_lines_land.geojson",
  "ne_50m_rivers_lake_centerlines.geojson",
];
const run = promisify(execFile);
const datasets = await Promise.all(
  files.map(async (file) => {
    // curl honors the host's proxy configuration, unlike Node's default fetch.
    const url = `https://api.github.com/repos/nvkelso/natural-earth-vector/contents/geojson/${file}?ref=${revision}`;
    const { stdout } = await run(
      "curl",
      [
        "-fsSL",
        "--retry",
        "1",
        "--connect-timeout",
        "10",
        "--max-time",
        "45",
        "-H",
        "Accept: application/vnd.github.raw+json",
        url,
      ],
      { maxBuffer: 32_000_000 },
    );
    const data = JSON.parse(stdout);
    if (data.type !== "FeatureCollection" || !data.features?.length)
      throw new Error(`Invalid geography dataset: ${file}`);
    return data;
  }),
);
const topologyBytes = await readFile(
  new URL("../../data/earth-topo.json", import.meta.url),
);
const topology = JSON.parse(topologyBytes);
const context = vm.createContext({});
vm.runInContext(
  await readFile(
    new URL("../../libs/topojson/1.1.0/topojson.js", import.meta.url),
    "utf8",
  ),
  context,
);
const feature = (name) =>
  context.topojson.feature(topology, topology.objects[name]);
const collection = (groups) => ({
  type: "FeatureCollection",
  features: groups.flatMap(([data, kind]) =>
    data.features.map((item) => ({
      type: "Feature",
      properties: {
        kind,
        name: item.properties?.name || item.properties?.NAME || "",
        scalerank: item.properties?.scalerank ?? 0,
      },
      geometry: item.geometry,
    })),
  ),
});
const output = {
  schema: 1,
  countries: {
    detail: collection([
      [feature("coastline_50m"), "coastline"],
      [datasets[0], "boundary"],
    ]),
    coarse: collection([
      [feature("coastline_110m"), "coastline"],
      [datasets[1], "boundary"],
    ]),
  },
  rivers: {
    detail: collection([
      [datasets[2], "river"],
      [feature("lakes_50m"), "lake"],
    ]),
    coarse: collection([
      [
        {
          ...datasets[2],
          features: datasets[2].features.filter(
            (item) => Number(item.properties?.scalerank ?? 0) <= 4,
          ),
        },
        "river",
      ],
      [feature("lakes_110m"), "lake"],
    ]),
    coarseTolerance: 0.12,
  },
};
const destination = new URL("../../data/geography/", import.meta.url);
await writeFile(
  new URL("reference-lines.json", destination),
  JSON.stringify(output) + "\n",
);
const sourcesPath = new URL("sources.json", destination);
const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
sources.reference_lines = {
  retrieved_at: new Date().toISOString(),
  repository_revision: revision,
  license: "Natural Earth public domain",
  terms: "https://www.naturalearthdata.com/about/terms-of-use/",
  source_urls: files.map((file) => root + file),
  bundled_coasts_and_lakes: {
    file: "../earth-topo.json",
    sha256: createHash("sha256").update(topologyBytes).digest("hex"),
  },
  display:
    "Natural Earth 1:50 million detail; 1:110 million coasts/borders and simplified major rivers during interaction",
  counts: Object.fromEntries(
    Object.entries(output)
      .filter(([key]) => key !== "schema")
      .map(([key, lod]) => [
        key,
        {
          detail: lod.detail.features.length,
          coarse: lod.coarse.features.length,
        },
      ]),
  ),
};
await writeFile(sourcesPath, JSON.stringify(sources) + "\n");
console.log(JSON.stringify(sources.reference_lines.counts));
