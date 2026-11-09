import test from "node:test";
import assert from "node:assert/strict";
import { gridSampler, geometricHeight, windDisplayHeight } from "./weather.js";
import { fetchMapResource } from "./map-runtime.js";

const header = {
  nx: 4,
  ny: 3,
  lo1: 0,
  la1: 90,
  dx: 90,
  dy: 90,
  refTime: "2026-11-07T18:00:00Z",
  forecastTime: 4,
  layer: "500hPa",
  pressureLevelHpa: 500,
};
const record = (value, extra = {}) => ({
  header: { ...header, ...extra },
  data: Array(12).fill(value),
});
const grid = () => gridSampler([record(3), record(4)], [record(280)]);
const profile = () => ({
  layer: "500hPa",
  orography: record(1000, { layer: "surface" }),
  surface_pressure: record(85000, { layer: "surface" }),
  height: record(5500),
});

test("GFS layer geometry follows HGT, retains vector direction and wraps the date line", () => {
  const g = grid();
  g.setHeightProfile(profile());
  assert.deepEqual(g.sample(-180, 30), g.sample(180, 30));
  assert.equal(g.sample(100, 30).speed, 5);
  const h = g.heightAt(100, 30);
  assert.ok(Math.abs(h.geopotential - 5500) < 1e-8);
  assert.ok(windDisplayHeight("500hPa", h, 1) > 5500);
  assert.ok(windDisplayHeight("500hPa", h, 1) < 5510);
  assert.ok(windDisplayHeight("500hPa", h, 10) > 45000);
  assert.ok(
    Math.abs(windDisplayHeight("surface", h, 20) - geometricHeight(1000) - 10) <
      1e-8,
  );
});

test("Underground pressure levels and missing height samples do not produce wind lines", () => {
  const g = grid(),
    p = profile();
  p.surface_pressure = record(48000);
  g.setHeightProfile(p);
  assert.equal(g.heightAt(100, 30).belowGround, true);
  assert.ok(Number.isNaN(windDisplayHeight("500hPa", g.heightAt(100, 30))));
  p.height.data.fill(null);
  assert.equal(g.heightAt(100, 30), null);
});

test("Never mix height from another forecast or pressure level", () => {
  const g = grid(),
    p = profile();
  p.height.header.forecastTime++;
  assert.throws(() => g.setHeightProfile(p), /时次/);
  const other = profile();
  other.layer = "850hPa";
  assert.throws(() => g.setHeightProfile(other), /气压层/);
});

test("Transient tile failures retry, while cancellation never starts another request", async () => {
  let calls = 0;
  const response = await fetchMapResource(
    "https://example.test/tile",
    {},
    async () => {
      calls++;
      return new Response("", { status: calls === 1 ? 503 : 200 });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchMapResource(
      "https://example.test/tile",
      { signal: controller.signal },
      () => {
        throw new Error("must not fetch");
      },
    ),
    { name: "AbortError" },
  );
});

test("A failure after response headers retries the body transfer", async () => {
  let calls = 0;
  const response = await fetchMapResource(
    "https://example.test/tile",
    {},
    async () => {
      calls++;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("connection lost during body"));
            },
          }),
        );
      return new Response("complete tile");
    },
  );
  assert.equal(await response.text(), "complete tile");
  assert.equal(calls, 2);
});
