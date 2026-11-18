export const CLOUD_VIEW_LIMITS = Object.freeze({
  preloadAltitude: 150000,
  volumeStartAltitude: 65000,
  volumeFullAltitude: 25000,
  nearDistance: 12000,
  farDistance: 40000,
  maxRayDistance: 150000,
});

/** Cloud positions are model-derived; standard pressure altitude is approximate. */
export function pressureAltitude(pa) {
  return Number.isFinite(pa) && pa > 0 && pa < 120000
    ? 44330 * (1 - Math.pow(pa / 101325, 0.190263))
    : null;
}
export function cloudBandTexture(band) {
  const { header: h, data: cover } = band.cover;
  const count = h.nx * h.ny;
  if (
    cover.length !== count ||
    band.bottom.data.length !== count ||
    band.top.data.length !== count
  )
    throw new Error("Incomplete cloud grid");
  for (const field of [band.bottom, band.top]) {
    for (const key of [
      "nx",
      "ny",
      "dx",
      "dy",
      "la1",
      "lo1",
      "refTime",
      "forecastTime",
    ])
      if (field.header[key] !== h[key])
        throw new Error("Cloud grid identity mismatch");
  }
  const pixels = new Float32Array(count * 4);
  let cloudy = 0;
  for (let i = 0; i < count; i++) {
    const bottom = pressureAltitude(band.bottom.data[i]);
    const top = pressureAltitude(band.top.data[i]);
    if (!Number.isFinite(cover[i]) || cover[i] < 0 || cover[i] > 100) continue;
    // Total coverage remains valid even when GFS masks this layer's vertical boundaries.
    // Only the orbital coverage projection may use such a column; volume requires alpha=1.
    pixels[i * 4] = cover[i] / 100;
    if (bottom === null || top === null || top <= bottom || top > 25000)
      continue;
    pixels[i * 4] = cover[i] / 100;
    pixels[i * 4 + 1] = Math.max(0, bottom) / 25000;
    pixels[i * 4 + 2] = Math.max(0, top) / 25000;
    pixels[i * 4 + 3] = 1;
    if (cover[i] > 5) cloudy++;
  }
  return { pixels, nx: h.nx, ny: h.ny, cloudy };
}

/** Camera altitude selects detail, without changing any cloud boundary. */
export function cloudViewDetail(altitude) {
  const h = Number.isFinite(altitude) ? Math.max(0, altitude) : Infinity;
  const smooth = (low, high) => {
    const t = Math.max(0, Math.min(1, (h - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  const volume =
    1 -
    smooth(
      CLOUD_VIEW_LIMITS.volumeFullAltitude,
      CLOUD_VIEW_LIMITS.volumeStartAltitude,
    );
  const detail = 1 - smooth(10000, 35000);
  return {
    volume,
    satellite: 1 - volume,
    detail,
    mode: volume === 0 ? "cloud-cover" : detail > 0.75 ? "volume" : "layered",
  };
}

/** Resolution and sample budget change with interaction, never cloud altitude. */
export function cloudRenderPlan(width, height, volume, moving) {
  const limit = volume > .001 ? (moving ? 448 : 768) : 2048;
  const factor = Math.min(1, limit / width, limit / height);
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
    steps: volume > 0 ? (moving ? 64 : 128) : 0,
  };
}
