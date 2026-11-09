// Copy this file to viewer/earth.config.local.js and fill in local credentials.
// The local file is ignored by git and is loaded by viewer pages when present.
window.WEATHER_EARTH_CONFIG = {
  // Used by viewer/earth.html and the local /3d/ service for Cesium terrain,
  // OSM Buildings and Google Photorealistic 3D Tiles.
  cesiumIonToken: "",

  // Used by viewer/earth.html for the Google Satellite basemap through Map
  // Tiles API, and by viewer/google-3d-maps-spike.html for the native Google
  // Maps JavaScript API 3D Maps comparison spike.
  googleMapsApiKey: "",

  // Optional weather raster tiles for viewer/globe.html and viewer/earth.html.
  // Use Google/third-party tile templates with {z}/{x}/{y}; {zoom}/{coord.x}/{coord.y}
  // are normalized automatically. Copy real URLs only into earth.config.local.js.
  weatherTiles: {
    cloud: "",
    infrared: "",
    radar: "",
  },

  // Optional Google Weather API map tiles. Google currently exposes weather
  // map types by mapType; set one here only when your API key is enabled for it.
  googleWeatherApiKey: "",
  googleWeatherMapTypes: {
    radar: "",
  },
};
