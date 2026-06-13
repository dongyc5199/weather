# Weather Geo Extractor

一个用于图片识别和经纬度提取的 Python 项目，覆盖两类常见场景：

- 从照片 EXIF 中读取真实 GPS 经纬度。
- 从天气图、风力图、色块地图中识别目标颜色区域，并按给定地图边界框换算为近似 GeoJSON 经纬度轮廓。

> 注意：天气图/截图是渲染后的图片，不是原始气象网格或 GIS 数据。本项目从图片色块推算出来的经纬度应标记为近似结果，适合快速分析、人工校对和生成第一版 GeoJSON，不适合作为权威边界。

## 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

## 1. 提取照片 EXIF 经纬度

```bash
weather-geo exif ./data/photo.jpg --output ./outputs/photo-gps.json
```

输出示例：

```json
{
  "source_image": "data/photo.jpg",
  "latitude": 39.9042,
  "longitude": 116.4074,
  "altitude_m": null,
  "method": "exif_gps"
}
```

## 2. 从天气图色块提取近似经纬度

先准备一个 HSV 色彩识别配置。项目内置示例：

```bash
examples/color_profiles.weather.json
```

运行识别：

```bash
weather-geo detect ./data/wind-map.png \
  --profile ./examples/color_profiles.weather.json \
  --bbox 73 18 135 54 \
  --map-rect 20 30 2770 2290 \
  --ignore-rect 0 0 250 260 \
  --ignore-rect 0 1670 700 2383 \
  --output ./outputs/wind-regions.geojson \
  --min-area-px 500
```

`--bbox` 顺序为：

```text
min_lon min_lat max_lon max_lat
```

例如中国区域可先用 `73 18 135 54` 做粗略校准。若图片有边框、标题、图例或留白，建议先裁剪到纯地图区域，或者为裁剪后的地图重新设置边界框。

常用参数：

- `--map-rect X1 Y1 X2 Y2`: 指定图片中真正对应经纬度边界框的主地图像素范围。
- `--ignore-rect X1 Y1 X2 Y2`: 排除 logo、图例、南海小图等非目标区域，可重复传入。

## 输出 GeoJSON

`detect` 命令输出 `FeatureCollection`，每个识别区域会包含：

- `label`: 色彩配置中的标签。
- `area_px`: 像素面积。
- `method`: `color_segmentation_linear_bbox_georef`。
- `accuracy`: `approximate_from_rendered_image`。
- `bbox_lonlat`: 区域经纬度包围盒。

## 调整颜色识别

HSV 范围格式：

```json
{
  "profiles": [
    {
      "label": "wind_force_6_plus",
      "lower_hsv": [0, 80, 80],
      "upper_hsv": [15, 255, 255]
    }
  ]
}
```

OpenCV 的 HSV 取值范围为：

- H: `0-179`
- S: `0-255`
- V: `0-255`

同一类天气色块可以配置多个 profile，用不同 `label` 区分。红色跨越 HSV 0 度边界时，可拆成两条规则，例如 `0-10` 和 `170-179`。

## 开发验证

```bash
pytest
```

## 本次 NMC 风速图示例

```bash
mkdir -p data outputs
curl -L 'https://image.nmc.cn/product/2026/06/10/STFC/SEVP_NMC_STFC_SFER_EDA_ACHN_L88_PB_20260610100000000.jpg?v=1781086389258' \
  -o data/nmc-wind-20260610-1000.jpg

weather-geo detect data/nmc-wind-20260610-1000.jpg \
  --profile examples/color_profiles.nmc_wind.json \
  --calibration examples/calibration.nmc_wind_china.json \
  --output outputs/nmc-wind-regions-fine.geojson \
  --min-area-px 50 \
  --simplify-epsilon 0.8 \
  --morph-kernel-size 5 \
  --no-morph-open
```

这组参数基于 `2026年6月10日18时` 的全国逐小时极大风速图调过一版，适合做校准后的 GeoJSON。`examples/calibration.nmc_wind_china.json` 内置了图例/logo 排除区域和 31 个城市控制点，不再依赖粗略线性 `--bbox`。

查看控制点拟合误差：

```bash
weather-geo calibration-report examples/calibration.nmc_wind_china.json \
  --image data/nmc-wind-20260610-1000.jpg
```

当前模板为二阶控制点模型，平均残差约 8.1km，最大残差约 18.4km。若后续要进一步逼近原图边界，可继续补控制点或升级为人工审核后的高精度边界控制点模板。

自动化处理入口：

```bash
weather-geo process-nmc-wind \
  --url 'https://image.nmc.cn/product/2026/06/10/STFC/SEVP_NMC_STFC_SFER_EDA_ACHN_L88_PB_20260610100000000.jpg?v=1781086389258' \
  --output outputs/nmc-wind-regions-fine.geojson
```

也可以处理已下载图片：

```bash
weather-geo process-nmc-wind \
  --image data/nmc-wind-20260610-1000.jpg \
  --output outputs/nmc-wind-regions-fine.geojson
```

`process-nmc-wind` 默认使用：

- 颜色配置：`examples/color_profiles.nmc_wind.json`
- 控制点校准：`examples/calibration.nmc_wind_china.json`
- 最小区域：`50px`
- 轮廓简化：`0.8px`
- 形态学开运算：默认关闭，用于保留小色块和细边界
- 形态学闭运算：默认开启，核大小 `5px`，用于修复风旗、文字等黑色细线切开的风区缺口

其中 6 级风区的青色阈值只保留高饱和、高亮度色块，用来排除底图里的浅蓝河流、水系和地名标注。

批量生成一个逐小时过程：

```bash
weather-geo process-nmc-wind-series \
  --start 202606101600 \
  --end 202606102200 \
  --image-dir data/nmc-wind \
  --geojson-dir outputs/nmc-wind \
  --manifest-output outputs/nmc-wind/manifest.json \
  --default-index peak
```

`process-nmc-wind-series` 的 `--start` / `--end` 使用北京时间，且包含结束小时。命令会自动把北京时间换算成 NMC 图片文件名里的 UTC 小时，例如北京时间 `202606101800` 会请求 `PB_20260610100000000.jpg`。如果目标图片已经存在，会直接复用本地图片；需要强制重新下载时加 `--force-download`。

批量命令会输出：

- `data/nmc-wind/YYYYMMDDHHMM.jpg`: 每小时原始高清图。
- `outputs/nmc-wind/YYYYMMDDHHMM.geojson`: 每小时风区 GeoJSON。
- `outputs/nmc-wind/manifest.json`: 页面时间轴和过程趋势使用的清单，包含区域数、7级以上区域数、面积、峰值时次和原图路径。

## 地图底座查看 GeoJSON

启动本地地图查看器：

```bash
weather-geo serve-map --port 8765
```

打开：

```text
http://127.0.0.1:8765/viewer/index.html
```

查看器使用 Leaflet 和 WGS84/Web Mercator 标准底图，默认加载：

```text
outputs/nmc-wind/202606101800.geojson
```

页面上可以直接输入 NMC 图片 URL，点击 `识别并渲染` 后会调用本地接口：

```text
POST /api/process-nmc-wind
```

接口会自动下载图片，使用默认 NMC 颜色配置和控制点校准模板生成 GeoJSON，并立即在地图上替换当前风区图层。页面也支持勾选 `输入后自动渲染`，粘贴完整 URL 后会自动触发处理。

处理成功后，页面会在侧栏显示“原始图片”对比图。这个图片来自后端实际下载并用于识别的本地文件，点击 `放大` 可以全屏查看，方便对照原始色块和地图上的 GeoJSON 结果。

页面中的 `下载当前 GeoJSON` 会下载当前地图上正在显示的结果；如果刚刚通过 URL 实时识别，下载文件会按 NMC 图片时间命名，例如 `nmc-wind-202606101200.geojson`。

如果已生成 `outputs/nmc-wind/manifest.json`、`outputs/nmc-wind/20260610*.geojson` 和对应的 `data/nmc-wind/20260610*.jpg`，页面会显示 `6月10日大风过程` 时间轴，可点击 16:00-22:00 或播放逐小时风区演变，并同步更新区域数、7级以上风区数和轮廓点数。过程标题、默认时次、峰值时次和每小时文件都来自 manifest，后续自动化任务只需要更新这个清单。

如果风区贴不到中国地图底座上，优先检查图片到经纬度的转换参数，例如控制点模板、图片版式、缩放比例。不要用高德、百度这类 GCJ-02/BD-09 底图直接校 WGS84 GeoJSON，否则会引入坐标偏移。

## 3D 地球天气元素

新的地球页入口：

```text
http://127.0.0.1:8765/viewer/earth.html?map=6.69/35.13104/107.15353
```

页面使用 CesiumJS Globe 作为完整 3D 地球引擎，默认底座为非 Google 且无需 token 的 `esri-world-imagery` 真实影像路线；天气数据仍然是 WGS84 GeoJSON。可以通过 `data` 参数直接加载一个 GeoJSON URL：

```text
http://127.0.0.1:8765/viewer/earth.html?map=5/35/107&data=../examples/weather-elements.geojson
```

也可以通过 `project` 参数加载完整工作台项目文档，恢复业务 GeoJSON、视角、底图、时次、透明度和图层显隐：

```text
http://127.0.0.1:8765/viewer/earth.html?project=../examples/weather-earth-project.json
```

天气元素通过 feature properties 自动分层：

- `weather_type: "wind-region"`: 风区面，支持 `fill`、`stroke`、`stroke-width`。
- `weather_type: "rain-region"`: 降水区面，支持 `intensity`、`precipitation`、`time` 和面样式。
- `weather_type: "temperature-region"`: 温度区面，支持 `temperature`、`temp_range`、`time` 和面样式。
- `weather_type: "front"`: 锋面线，支持 `front_type`、`strength`、`time` 和线样式。
- `weather_type: "track"`: 台风/移动路径，支持 LineString 路径和 Point 节点，支持 `time`、`wind`、`strength`、`label`。
- `weather_type: "warning"`: 预警点，支持 `warning_type`、`level`、`time`、`marker-color`、`marker-size`。
- `weather_type: "station"`: 观测站点，支持 `station_id`、`value`、`unit`、`time`。
- `weather_type: "pressure-center"`: 气压中心点，支持 `pressure_type`、`pressure_hpa`、`time`。

地球模式支持慢速自动旋转，适合天气态势展示；拖拽、缩放、旋转或俯仰地图时会短暂停顿，避免和手动操作冲突。关闭 `地球自动旋转` 后，分享链接会追加 `rotate=0` 来恢复同一状态。

如果只需要检查地球本体效果，可在分享链接里追加 `weather=0`，页面会进入纯地球视图，不加载默认风区、城市影响点或其他业务天气图层。

`esri-world-imagery` 是默认真实影像底座，不需要 Cesium ion token。`cesium-world-terrain` 和可选的 `google-photorealistic-3d-tiles` 需要 Cesium ion token；复制 `viewer/earth.config.example.js` 为 `viewer/earth.config.local.js` 并填写 `cesiumIonToken` 即可启用这些增强底座。本地配置文件已被 `.gitignore` 忽略，不应提交。也可以临时使用 URL 参数 `ionToken=...` / `cesiumIonToken=...` 或页面内的临时 token 输入框，分享链接不会把 token 写回 URL。没有 token 或授权失败时，页面会自动使用 `openstreetmap-imagery` 或 `natural-earth` 继续启动，不再白屏。

地图底座和天气 GeoJSON 是两套独立数据：底座负责地球、地形、影像或可选摄影测量网格，天气 GeoJSON 只负责风区、路径、预警点等业务要素。页面支持 `basemap` 参数和底座下拉切换：

- `esri-world-imagery`: 默认路线，ArcGIS World Imagery 球面影像底图，不依赖 Google Maps API 或 Cesium ion token。
- `cesium-world-terrain`: Cesium World Terrain + 影像底图，不依赖 Google Maps API，但需要 Cesium ion token。
- `openstreetmap-imagery`: OpenStreetMap 球面底图，适合无 token 开发兜底。
- `natural-earth`: 页面本地生成的低分辨率地球纹理，外部地图服务不可用时兜底。
- `google-photorealistic-3d-tiles`: 可选 Google 摄影测量 3D Tiles，不再是默认依赖。

地球本体由 Cesium 的真实三维相机、空间背景、大气、Globe 地形/影像或可选 3D Tiles 构成。底座、天气面、路径、点标记、光柱和风区体块都属于显示层，不会进入 `下载 GeoJSON` 的业务数据。

页面提供 `quality=quality|balanced|performance` 三档 Cesium 质量配置，并保存到项目文档 `view.qualityProfile`。`quality` 优先接近 Google Earth 观感，使用完整分辨率和更高抗锯齿；当底座为 Google 3D Tiles 时也会降低 3D Tiles 屏幕误差。`balanced` 适合日常浏览；`performance` 降低瓦片和像素压力，适合弱显卡或慢网络。拖动、滚轮缩放、右键俯仰和连续键盘飞行时，页面会短暂进入交互性能模式，降低拾取频率、延后分享 URL 写入，并临时降低分辨率、抗锯齿和瓦片误差压力；停止操作后自动恢复所选画质。外部系统可调用 `setQualityProfile(...)`、`getQualityProfile()`、`captureMetrics()`、`getBenchmarkPaths()` 和 `runBenchmarkPath(...)` 做可重复的画质/性能验收。

P1 视觉升级把默认首屏收敛到 Google Earth 式完整地球视角，地点预设和巡航路径仍使用 40-60 度斜视范围，并集中调了曝光、天空色偏、地平线雾化和画面滤镜，减少山地近景过暗、过硬的问题。内置 benchmark 路径包括 `google-earth-p1`、`terrain-cinematic`、`city-oblique`、`weather-analysis`，可用于同一镜头路径下反复截图和采样性能指标。

P2 新增一个独立的 Google Maps JavaScript API 3D Maps 对比页，不替换 Cesium 主地球页：

```text
http://127.0.0.1:8765/viewer/google-3d-maps-spike.html
```

该页面用于把 Google 原生 3D Maps renderer 与 Cesium + Google Photorealistic 3D Tiles 放在同一组镜头路径下比较。它复用 P1 的地点预设和 benchmark 路径，提供 `window.google3dSpike.getBenchmarkPaths()`、`runBenchmarkPath(...)`、`captureMetrics()`、`flyToCamera(...)`、`setGeoJson(...)` 等调试 API，并把示例天气 GeoJSON 轻量转换为 Google 3D marker、polyline 和 polygon。它不是完整编辑器，也不承担 `WeatherEarthClient` 的兼容职责；完整天气编辑、项目文档、时次过程和 Cesium 指标仍以 `viewer/earth.html` 为准。

Google 3D Maps 对比页需要 Google Maps JavaScript API key。可以在本地 `viewer/earth.config.local.js` 里填写 `googleMapsApiKey`，也可以临时使用 URL 参数 `googleMapsApiKey=...` / `mapsApiKey=...` / `key=...` 或页面内输入框。`viewer/earth.config.local.js` 已被 `.gitignore` 忽略；不要把 API key 提交到仓库。没有 key、授权失败或 referrer 限制不匹配时，页面会显示配置提示，不会白屏。

页面会保留 Cesium/Google 原生 attribution，避免隐藏 Google Photorealistic 3D Tiles 的必要归因。沉浸模式下 attribution 会以内容宽度的小型低噪声样式显示在画布底部，不会形成长条空栏，也不会遮挡右上角相机控制区。

右上角地球控制区支持沉浸模式，开启后侧栏和业务浮层退出布局，地图画布占满视口，更接近 Google Earth 的浏览状态。当前沉浸模式只保留右上角指南针、相机控制按钮和 `☰` 地球菜单；搜索、天气、过程、图层、HUD、概览、夹角滑杆和底部状态面板都会隐藏，移动端也保持右侧竖向控件而不是铺满顶部。`☰` 会先打开轻量菜单，用户可从菜单进入完整工作台、重置视角、切换俯视或倾斜视角；进入工作台后，同一按钮可返回沉浸地球。默认首屏使用响应式完整地球构图，桌面保持地球主体居中偏左、右侧保留操作区空间，窄屏会自动拉远以避免地球左右被裁切。分享链接可用 `immersive=1` 恢复；项目文档会保存 `view.immersive`，外部系统可调用 `setImmersiveMode(true | false)` 控制。沉浸模式只影响工作台布局，不会修改业务 GeoJSON。

非沉浸/面板模式提供镜头动作：`聚焦` 会把当前画面中心设为地球聚焦点，`环绕` 会围绕聚焦点自动观察，`书签` 会保存当前镜头，`巡航` 会播放保存的镜头序列。这些状态保存到项目文档的 `view.focusTarget`、`view.focusOrbit` 和 `view.cameraTour`，不会写入业务 GeoJSON。

地球交互按 Google Earth 方向做了独立控制：右侧提供放大、缩小、左右旋转、俯仰、重置视角、地球菜单和回正朝北；沉浸模式下只保留这组地图导航控件。鼠标右键拖拽可横向调整航向、纵向调整地面夹角；触控板或滚轮按住 `Shift` / `Option` / `Alt` 纵向滚动可连续调整倾角，普通滚轮仍用于缩放。页面允许缩放到完整地球球体视角，非沉浸布局下左下角镜头 HUD 会实时显示中心经纬度、估算视距、航向、倾角和层级。

地球页支持 Google Earth 式连续键盘飞行控制，方便沉浸模式下浏览：按住方向键会按当前高度和航向平滑平移视角，按住 `Shift + 左/右` 连续旋转航向，按住 `Shift + 上/下` 连续调整俯仰，按住 `+` / `-` 或 `PageUp` / `PageDown` 连续缩放，`N` 回正朝北，`R` / `H` 重置到完整地球首屏，`U` 回到俯视，`O` 在俯视和倾斜视角之间切换，`Esc` 关闭地球菜单；加载 manifest 天气过程后，空格可播放/暂停过程，`[` / `]` 可切换前后时次。输入框、下拉框、按钮和文本编辑区获得焦点时会自动跳过这些快捷控制，避免影响数据编辑。

地球页右下角提供概览导航小地图，会用中国经纬度范围同步显示当前镜头中心、航向、当前风区外接范围和聚焦点。点击概览画布可直接飞往对应经纬度，点击标签区会回到当前风区范围；移动端会自动避开过程条、镜头 HUD 和底部底图徽标。

页面提供地点飞行预设，包括中国全景、北京、上海、广州、深圳、成都、拉萨、青藏高原、新疆山地、太行山、横断山谷地和南海视角。外部系统可调用 `flyToPlace("beijing")`、`flyToCamera({ lon, lat, zoom, bearing, pitch })` 或 `setCameraPitch(60)` 触发镜头变化，适合把天气过程、预警点或城市影响跳转做成 Google Earth 式镜头体验。

搜索定位支持输入城市名、拼音、区域别名和经纬度，例如 `深圳`、`shenzhen`、`116.4074,39.9042` 或 `39.9042,116.4074`。定位后会飞行到目标并在地球上显示搜索标记；项目文档会保存 `view.locationSearch`。外部系统可先调用 `searchPlaces(query)` 获取候选，再调用 `flyToSearch(query)` 直接飞行。

地球聚焦支持为搜索结果、飞行预设或任意经纬度建立 Google Earth 式目标反馈，包括地表光环、标签和垂直 3D 引导柱。用户可点击 `聚焦中心` 或双击地图建立聚焦，项目文档会保存 `view.focusTarget`；外部系统可调用 `setFocusTarget({ lon, lat, label })`、`getFocusTarget()` 和 `clearFocusTarget()` 控制。聚焦层是展示状态，不会写入业务 GeoJSON。

单击地表会打开临时地表信息探针，显示坐标、地表高程、当前层级、底图和可见地图细节数量，并可一键把该点设为聚焦目标。外部系统可调用 `setSurfaceProbe({ lon, lat })`、`getSurfaceProbe()` 和 `clearSurfaceProbe()` 控制。地表探针只用于校验和浏览，不会写入业务 GeoJSON。

聚焦目标支持环绕观察模式。开启 `环绕聚焦目标` 后，镜头会围绕当前聚焦点改变航向，适合展示城市 3D 建筑、预警点和风区边界；项目文档会保存 `view.focusOrbit`，分享链接可用 `focusOrbit=1` 恢复该模式，外部系统可调用 `setFocusOrbit(true | false)` 控制。

视角巡航支持把当前地球镜头保存为书签，并按顺序播放一组镜头点。巡航数据保存到 `view.cameraTour`，包含镜头中心、缩放、航向、倾角、飞行时长和可选 `time` 时次，不会写入业务 GeoJSON。播放巡航时，如果书签带有 `time`，页面会自动切换当前时次并显示导览提示；外部系统可用 `addCameraTourStop()`、`setCameraTour()`、`playCameraTour()` 和 `getCameraTour()` 做天气过程的自动讲解镜头。

测量工具支持距离和面积两种模式。点击地图添加测量点，实时显示路径长度和多边形面积；结果会保存到 `view.measurement`，但不会写入业务 GeoJSON。外部系统可调用 `startMeasurement("distance" | "area")`、`addMeasurementPoint({ lon, lat })`、`finishMeasurement()`、`getMeasurement()` 和 `clearMeasurement()` 控制工具状态。

地球模式支持 Cesium Globe 地形状态，默认开启。`cesium-world-terrain` 下会使用 Cesium World Terrain；不支持独立地形的底座会自动使用椭球表面。分享链接可用 `terrain=0` 记录关闭状态，用 `terrainExag=1.35` 调整项目文档中的地形强度；外部系统也可以通过 `setTerrain()` 和 `setTerrainExaggeration()` 控制。

地球模式支持 Cesium 太阳光照，默认开启。未选择业务时次时，页面会定期把 Cesium 时钟同步到浏览器当前时间；选择 `time`、播放 manifest 天气过程或调用 `setSunlightTime("06/10 18:00")` 后，太阳位置会固定到对应天气时次。分享链接可用 `sunlight=0` 关闭，用 `sunlightIntensity=0.85` 调整光照强度；项目文档会保存 `view.sunlight` 的强度和太阳时间状态，外部系统也可以通过 `setSunlight()`、`setSunlightIntensity()` 和 `setSunlightTime()` 控制。光照只影响显示，不会写入导出的业务 GeoJSON。

城市尺度摄影测量建筑只在可选 `google-photorealistic-3d-tiles` 底座下可用。非 Google 默认底座会保留 `buildings` 状态用于项目兼容，但 `view.buildings.enabled` 会明确返回不可用。分享链接可用 `buildings=0` 记录关闭状态，用 `buildingScale=1.2` 保存建筑高度偏好；项目文档会保存 `view.buildings`，外部系统也可以通过 `setBuildings()` 和 `setBuildingHeightScale()` 控制。

点状天气支持 3D 光柱标记，默认开启，用于在地球视角下突出预警点、站点和路径节点。分享链接可用 `weather3d=0` 关闭，用 `weather3dScale=1.4` 调整高度；项目文档会保存 `view.weather3d`，外部系统也可以通过 `setWeather3d()` 和 `setWeather3dScale()` 控制。光柱是显示层派生数据，不会写入导出的业务 GeoJSON。

面状风区支持 3D 半透明体块，默认开启，用于在倾斜地球视角下突出风力覆盖范围和等级差异。分享链接可用 `weatherVolume=0` 关闭，用 `weatherVolumeScale=1.4` 调整体块高度；项目文档会保存 `view.weatherVolume`，外部系统也可以通过 `setWeatherVolume()` 和 `setWeatherVolumeScale()` 控制。体块高度由风级、风速或显式高度字段派生，属于显示层内部字段，不会写入导出的业务 GeoJSON。

推荐把天气 GeoJSON 当成一个可交付的数据文档处理：顶层保留 `type: "FeatureCollection"`、`name` 和可选 `metadata`，其中 `metadata.projection` 建议固定为 `WGS84 lon/lat`，`metadata.schema` 可写成内部版本号，例如 `weather-earth-geojson-v1`。页面会保留这些顶层字段，同时按 feature 的 `properties.weather_type` 做业务分层。

示例文件：

```text
examples/weather-elements.geojson
examples/weather-time-filter.geojson
examples/weather-earth-project.json
```

也可以通过 `manifest` 参数加载一组时次并播放：

```text
http://127.0.0.1:8765/viewer/earth.html?map=6.69/35.13104/107.15353&manifest=../outputs/nmc-wind/manifest.json
```

Manifest 支持 `items` 或 `frames` 数组。每个时次至少需要一个 `geojsonUrl` 字段，现有 `process-nmc-wind-series` 生成的 `outputs/nmc-wind/manifest.json` 可以直接加载。

页面侧栏的 `GeoJSON 文本` 可以直接查看、格式化和编辑当前数据；点击 `应用文本` 后会重新分层渲染到地球，适合快速调试天气点、路径、风区属性和样式。

页面侧栏的 `数据文档` 面板会显示当前 GeoJSON 的来源、存储状态、坐标系、经纬度范围、全量/当前显示要素数、时次数、JSON 大小和加载时间。默认会写入会话缓存；点击 `保存草稿` 会把当前 GeoJSON 写入浏览器本地草稿，后续可以用 `恢复` 找回，适合模拟 geojson.io 这类“浏览器内编辑一个 GeoJSON 文档”的工作流。`标准化` 会批量补齐 `metadata.schema`、`metadata.projection`、`weather_type`、名称和样式字段，不会修改几何坐标，适合把自动识别或外部导入的普通 GeoJSON 整理成天气元素 GeoJSON。

参考 geojson.io 的处理方式，本项目把数据拆成三层：Cesium 底座负责真实地球、地形/影像或可选 3D Tiles；业务 GeoJSON 只保存天气对象本身；项目文档保存当前视角、引擎、底座 provider、时次、图层显隐和编辑状态。这样图片识别服务只需要输入图片 URL、输出 WGS84 GeoJSON，地球页面负责加载、编辑、校验、下载和分享，不把底座、token 或 UI 状态混进业务 GeoJSON。

地球页内置 `展示`、`校验`、`城市` 三组场景预设：`展示` 面向态势演示，默认 Cesium Globe、昼夜光照和轻量天气叠加；`校验` 面向 GeoJSON 贴合检查，降低 3D 天气干扰并提高天气面透明度；`城市` 面向城市级预警点和影响范围，非 Google 底座下保留天气标记和风区体块，Google 底座下额外可见摄影测量建筑。分享链接可用 `scene=showcase|audit|city` 恢复预设；如果用户手动改动透明度或 3D 开关，项目文档会把场景标记为 `custom`。

`下载项目文档` 会导出 `WeatherEarthProject` JSON，包含当前业务 GeoJSON、场景预设、沉浸布局、地图中心/缩放/俯仰、`view.engine: "cesium"`、`view.tileset`、真实地图细节状态、自动旋转、地点聚焦、聚焦环绕、3D 地形、昼夜光照、3D 建筑、3D 天气标记、3D 风区体块、时次筛选、无时次开关、天气透明度、图层显隐和天气元素类型显隐状态。它用于恢复完整地球工作台；`下载 GeoJSON` 仍然只导出干净的业务 FeatureCollection，更适合作为识别服务的正式交付数据。项目文档也可以部署成 URL 后通过 `project=...` 加载；如果链接里同时带有 `map`、`scene`、`immersive`、`time`、`basemap`、`rotate`、`focusOrbit`、`untimed`、`mapDetails`、`terrain`、`sunlight`、`buildings`、`weather3d` 或 `weatherVolume`，这些 URL 状态会覆盖项目文档里的旧视图状态。

如果把地球页嵌入另一个项目，可以直接调用页面 API：

```js
window.weatherEarth.setGeoJson(geojson, { name: "nmc-wind.geojson", fit: true });
window.weatherEarth.appendGeoJson(warningPoints, { name: "warnings.geojson" });
window.weatherEarth.addWeatherElement({
  weatherType: "warning",
  lon: 116.4074,
  lat: 39.9042,
  name: "大风预警",
  time: "06/10 18:00",
  level: "橙色",
  color: "#ff8f3d"
}, { select: true, fitSelected: true });
await window.weatherEarth.setBasemap("esri-world-imagery");
window.weatherEarth.setImmersiveMode(true);
window.weatherEarth.setMapDetails(true);
window.weatherEarth.setTerrain(true);
window.weatherEarth.setTerrainExaggeration(1.35);
window.weatherEarth.setSunlight(true);
window.weatherEarth.setSunlightIntensity(0.85);
window.weatherEarth.setBuildings(true);
window.weatherEarth.setBuildingHeightScale(1.2);
window.weatherEarth.setWeather3d(true);
window.weatherEarth.setWeather3dScale(1.4);
window.weatherEarth.setWeatherVolume(true);
window.weatherEarth.setWeatherVolumeScale(1.25);
window.weatherEarth.setScenePreset("city");
const scenePresets = window.weatherEarth.getScenePresets();
const matches = window.weatherEarth.searchPlaces("深圳");
window.weatherEarth.flyToSearch("116.4074,39.9042");
window.weatherEarth.setFocusTarget({ lon: 116.4074, lat: 39.9042, label: "北京预警焦点" });
window.weatherEarth.setSurfaceProbe({ lon: 116.4074, lat: 39.9042 });
window.weatherEarth.setFocusOrbit(true);
window.weatherEarth.startMeasurement("distance");
window.weatherEarth.addMeasurementPoint({ lon: 116.4074, lat: 39.9042 });
const measurement = window.weatherEarth.getMeasurement();
window.weatherEarth.flyToPlace("beijing");
window.weatherEarth.flyToCamera({ lon: 116.4074, lat: 39.9042, zoom: 15.5, bearing: -25, pitch: 60 });
window.weatherEarth.addCameraTourStop({ label: "北京预警", time: "06/10 18:00", camera: { lon: 116.4074, lat: 39.9042, zoom: 12, bearing: -18, pitch: 55 } });
window.weatherEarth.playCameraTour();
window.weatherEarth.setTimeFilter("06/10 18:00");
window.weatherEarth.setSunlightTime("06/10 18:00");
const currentGeoJson = window.weatherEarth.getGeoJson();
const visibleGeoJson = window.weatherEarth.getGeoJson({ visible: true });
const validation = window.weatherEarth.validate();
window.weatherEarth.standardize();
window.weatherEarth.fitWeather();
```

跨窗口或 iframe 集成时推荐使用 `WeatherEarthClient`：

```html
<iframe id="earthFrame" src="/viewer/earth.html?map=5/35/107"></iframe>
<script src="/viewer/weather-earth-client.js"></script>
<script>
  const earth = new WeatherEarthClient("#earthFrame");
  await earth.waitUntilReady();
  await earth.setGeoJson(geojson, { name: "nmc-wind.geojson", fit: true });
  await earth.appendGeoJson(warningPoints, { name: "warnings.geojson" });
  await earth.setTimeFilter("06/10 18:00");
  await earth.setSunlightTime("06/10 18:00");
  const currentGeoJson = await earth.getGeoJson();
  const visibleGeoJson = await earth.getVisibleGeoJson();
  const project = await earth.getProject();
  await earth.setProject(project);
  await earth.loadProjectUrl("/examples/weather-earth-project.json");
  const warning = await earth.addWeatherElement({
    weatherType: "warning",
    lon: 116.4074,
    lat: 39.9042,
    name: "大风预警",
    time: "06/10 18:00",
    level: "橙色",
    color: "#ff8f3d"
  }, { select: true, fitSelected: true });
  const windRegion = await earth.createWeatherElement({
    weatherType: "wind-region",
    name: "6级大风区",
    time: "06/10 18:00",
    level: "6级",
    color: "#00d6f2",
    coordinates: [[104, 34], [105, 34], [105, 35], [104, 35]]
  });
  const created = await earth.addFeature({
    type: "Feature",
    properties: { weather_type: "warning", name: "大风预警", time: "06/10 18:00", "marker-color": "#ff8f3d" },
    geometry: { type: "Point", coordinates: [116.4074, 39.9042] }
  }, { select: true, fitSelected: true });
  await earth.updateFeature(created.id, { properties: { level: "橙色" } });
  await earth.selectFeature(created.id, { fit: true });
  await earth.deleteFeature(created.id);
  const features = await earth.getFeatures();
  const layers = await earth.getLayers();
  const elementTypes = await earth.getElementTypes();
  const elementTypeState = await earth.getElementTypeState();
  await earth.setElementTypeVisibility("rain-region", false);
  await earth.setAllElementTypeVisibility(true);
  await earth.setLayerVisibility("wind-regions", false);
  await earth.setWeatherOpacity(0.35);
  await earth.setImmersiveMode(true);
  await earth.setMapDetails(true);
  await earth.setTerrain(true);
  await earth.setTerrainExaggeration(1.35);
  await earth.setSunlight(true);
  await earth.setSunlightIntensity(0.85);
  await earth.setBuildings(true);
  await earth.setBuildingHeightScale(1.2);
  await earth.setWeather3d(true);
  await earth.setWeather3dScale(1.4);
  await earth.setWeatherVolume(true);
  await earth.setWeatherVolumeScale(1.25);
  await earth.setScenePreset("city");
  const scenePresets = await earth.getScenePresets();
  const matches = await earth.searchPlaces("深圳");
  await earth.flyToSearch("116.4074,39.9042");
  await earth.setFocusTarget({ lon: 116.4074, lat: 39.9042, label: "北京预警焦点" });
  await earth.setSurfaceProbe({ lon: 116.4074, lat: 39.9042 });
  await earth.setFocusOrbit(true);
  await earth.startMeasurement("area");
  await earth.addMeasurementPoint({ lon: 116.4074, lat: 39.9042 });
  const measurement = await earth.getMeasurement();
  await earth.clearMeasurement();
  await earth.flyToPlace("beijing");
  await earth.flyToCamera({ lon: 116.4074, lat: 39.9042, zoom: 15.5, bearing: -25, pitch: 60 });
  await earth.setCameraTour([
    { label: "中国全景", time: "06/10 18:00", camera: { lon: 107.15, lat: 35.1, zoom: 5.35, bearing: -14, pitch: 36 } },
    { label: "北京预警", time: "06/10 19:00", camera: { lon: 116.4074, lat: 39.9042, zoom: 12, bearing: -18, pitch: 55 } }
  ]);
  const cameraTour = await earth.getCameraTour();
  await earth.playCameraTour();
  const validation = await earth.validate();
  const validationReport = await earth.getValidationReport();
  await earth.standardize();
  await earth.fitWeather();

  const unsubscribe = earth.on("change", (event) => {
    console.log(event.reason, event.geojson, event.state.featureCount);
  });
  earth.on("filterchange", (event) => {
    console.log(event.reason, event.visibleGeoJson, event.state.activeTimeFilter);
  });
  earth.on("layerchange", (event) => {
    console.log(event.reason, event.layers, event.weatherOpacity);
  });
  earth.on("ready", (event) => {
    console.log("earth ready", event.methods);
  });
</script>
```

`WeatherEarthClient` 的业务调用默认会等 iframe 发出 `ready` 后再执行，所以外部项目可以在创建 iframe 后立即调用 `setGeoJson()`、`appendGeoJson()` 等方法；如果希望显式控制初始化时机，可先 `await earth.waitUntilReady()` 或 `await earth.getReady()`。`ready` 事件会返回地球页可用方法列表、地图加载状态和当前状态。

`change` 会在加载、追加、绘制、编辑、删除、清空或标准化 GeoJSON 后触发，事件里包含清理过内部字段的 `geojson`、当前显示用的 `visibleGeoJson` 和地图状态 `state`。`filterchange` 会在时次筛选或无时次开关变化后触发，适合外部项目同步“当前屏幕上正在展示的天气要素”。

Feature 级 API 会返回内部稳定 `id` 和清理后的业务 `feature`。这个 `id` 只用于页面会话里的编辑、选中和删除；`getGeoJson()`、下载和分享导出的 GeoJSON 默认不会带 `_earthFeatureId`，避免污染业务数据。如果另一个系统需要长期追踪同一个天气对象，建议在 `properties` 里额外放自己的业务主键，例如 `event_id`、`warning_id` 或 `source_object_id`。

如果外部系统只是“放一个天气对象到地球上”，优先用 `addWeatherElement()`，它会把 `{ weatherType, lon, lat, coordinates, name, time, level, color }` 这类简化输入转换成标准 GeoJSON Feature，并自动补齐 `weather_type`、样式和常用业务字段。`createWeatherElement()` 只创建 Feature 不写入当前数据，适合先生成、校验、再批量合并；`addFeature()` 仍然保留给已经构造好完整 GeoJSON Feature 的场景。

天气元素类型由内置目录统一维护，`getElementTypes()` 会返回类型 ID、中文标签、默认几何、默认属性、渲染分组和推荐颜色。外部项目可以先读取这个目录，再按 `weather_type` 生成风区、降水区、锋面、站点、预警点等天气元素。页面侧栏的 `天气元素类型` 图例会显示每类要素的全量/当前显示数量，并支持按类型显示或隐藏；`getElementTypeState()`、`setElementTypeVisibility(id, visible)`、`setAllElementTypeVisibility(visible)` 可供 iframe 集成同步外部 UI。类型显隐会影响地图、要素列表、`下载当前显示` 和 `getVisibleGeoJson()`，但不会修改原始业务 GeoJSON。

图层控制使用业务图层 ID：`wind-regions`、`track-example`、`warning-points`、`city-impact`。`getLayers()` 会返回图层显示状态、要素数和摘要；`setLayerVisibility(id, visible)` 只控制展示，不修改 GeoJSON；`setWeatherOpacity(value)` 当前控制面状天气区填充透明度，取值会限制在 `0.15-0.9`。这类展示变更会触发 `layerchange`，适合外部 UI 同步开关状态。

底层协议仍然是 `postMessage`：

```js
iframe.contentWindow.postMessage({
  target: "weather-earth",
  type: "set-geojson",
  requestId: "load-001",
  geojson,
  options: { name: "nmc-wind.geojson", fit: true }
}, "*");
```

`postMessage` 支持的请求消息类型包括：`ping`、`get-ready`、`set-geojson`、`append-geojson`、`get-project`、`set-project`、`create-weather-element`、`add-weather-element`、`add-feature`、`update-feature`、`delete-feature`、`select-feature`、`get-features`、`get-layers`、`get-quality-profile`、`set-quality-profile`、`capture-metrics`、`get-benchmark-paths`、`run-benchmark-path`、`get-places`、`get-scene-presets`、`set-scene-preset`、`search-places`、`get-focus-target`、`set-focus-target`、`clear-focus-target`、`get-surface-probe`、`set-surface-probe`、`clear-surface-probe`、`set-focus-orbit`、`fly-to-place`、`fly-to-search`、`fly-to-camera`、`get-element-types`、`get-element-type-state`、`set-element-type-visibility`、`set-all-element-type-visibility`、`set-layer-visibility`、`set-weather-opacity`、`set-map-details`、`set-terrain`、`set-terrain-exaggeration`、`set-sunlight`、`set-sunlight-intensity`、`set-sunlight-time`、`set-buildings`、`set-building-height-scale`、`set-weather-3d`、`set-weather-3d-scale`、`set-weather-volume`、`set-weather-volume-scale`、`get-measurement`、`start-measurement`、`add-measurement-point`、`finish-measurement`、`undo-measurement-point`、`clear-measurement`、`get-camera-tour`、`set-camera-tour`、`add-camera-tour-stop`、`play-camera-tour`、`stop-camera-tour`、`clear-camera-tour`、`load-geojson-url`、`load-manifest-url`、`load-project-url`、`set-basemap`、`set-projection`、`set-immersive`、`set-time-filter`、`clear-weather`、`get-state`、`get-geojson`、`validate-geojson`、`get-validation-report`、`standardize-weather`、`fit-weather`。其中 `get-geojson` 可传 `options: { visible: true }` 只取当前时次和类型显隐筛选后的显示结果，默认会去掉 `_earthFeatureId` 等页面内部字段，适合直接作为业务 GeoJSON 交付；`get-quality-profile` / `set-quality-profile` 用于切换 `quality`、`balanced`、`performance` 三档 Cesium/3D Tiles 质量策略；`capture-metrics` 会返回 FPS、帧耗时、分辨率、当前底座 provider、可用瓦片/资源请求统计和 attribution 状态；`get-benchmark-paths` / `run-benchmark-path` 会枚举或执行固定镜头路径并逐站采样指标，适合 Google Earth 效果对比验收；`get-scene-presets` / `set-scene-preset` 用于恢复展示、校验、城市三类内置地球场景；`set-immersive` 用于切换地图优先的沉浸布局；`create-weather-element` / `add-weather-element` 适合外部系统用简化天气对象接入；`get-places` / `fly-to-place` / `fly-to-search` / `fly-to-camera` 用于 Google Earth 式镜头飞行和搜索定位；`get-focus-target` / `set-focus-target` / `clear-focus-target` 用于控制地球目标聚焦层；`get-surface-probe` / `set-surface-probe` / `clear-surface-probe` 用于控制临时地表信息探针；`set-focus-orbit` 用于控制围绕聚焦点的镜头环绕；`get-camera-tour` / `set-camera-tour` / `add-camera-tour-stop` / `play-camera-tour` 用于控制 Google Earth 式视角巡航；`get-measurement` / `start-measurement` / `add-measurement-point` / `finish-measurement` / `clear-measurement` 用于控制临时测量工具层；`set-map-details` 用于控制行政边界、水系、道路和地名矢量叠加；`set-terrain` / `set-terrain-exaggeration` 用于控制 3D 地形；`set-sunlight` / `set-sunlight-intensity` / `set-sunlight-time` 用于控制昼夜光照层和太阳时间；`set-buildings` / `set-building-height-scale` 用于控制城市 3D 建筑；`set-weather-3d` / `set-weather-3d-scale` 用于控制点状天气的 3D 光柱；`set-weather-volume` / `set-weather-volume-scale` 用于控制面状风区 3D 体块；`get-project` / `set-project` / `load-project-url` 用于保存和恢复完整地球工作台状态；`validate-geojson` 会返回 `{ ok, errors, warnings, summary, issues }`，适合自动化接入前判断是否缺天气类型、缺时次、缺样式或几何异常；`get-validation-report` 会返回 `WeatherEarthValidationReport`，额外包含来源、视图、图层和天气类型显隐状态。地球页也会主动向父窗口发送 `{ target: "weather-earth-client", type: "event", event: "ready" | "change" | "filterchange" | "layerchange" | "scenechange" | "qualitychange" | "immersivechange" | "mapdetailschange" | "sunlightchange" | "focuschange" | "surfaceprobechange" | "focusorbitchange" | "weather3dchange" | "weathervolumechange" | "searchchange" | "measurementchange" | "tourchange", detail }`，外部项目可直接监听 `message` 或使用 `WeatherEarthClient.on(...)`。

可运行的嵌入示例：

```text
http://127.0.0.1:8765/viewer/earth-embed-demo.html
```

页面侧栏的 `绘制天气元素` 支持在地球上点击新增点、线和面：点默认作为预警点，线默认作为路径，面默认作为风区。新增要素会立即写入当前 GeoJSON、同步文本编辑区，并进入本地会话数据。

地图上的天气要素可以直接点击选中，并在 `选中要素` 面板里修改名称、类型、颜色、自定义 `properties` 字段和 `geometry` 坐标，或者删除该要素。更新和删除会同步刷新 GeoJSON 文本和所有天气图层。地图点击还会弹出属性摘要，便于核对等级、时间、风速、来源等天气字段。

`选中要素` 面板里的 `套用类型模板` 会按当前类型补齐常用天气字段：风区补 `level/time/wind_speed/source`，降水区补 `intensity/precipitation/time/source`，锋面补 `front_type/strength/time/source`，路径补 `time/strength/wind/source`，预警点补 `warning_type/level/time/source`。已有字段会保留，便于把自动识别输出逐步标准化。

`要素列表` 会列出当前 GeoJSON 的点、线、面要素，可按名称、类型或几何筛选；点击列表项会选中并定位到对应天气要素。

`时次筛选` 会从当前 GeoJSON 的 `time`、`valid_time`、`validTime`、`forecast_time`、`issued_at`、`datetime`、`timestamp` 字段中提取可选时次。选择某个时次后，地球图层、要素列表、统计和城市影响都会切换到该时次；`显示无时次要素` 可保留底层边界、长期有效区域等没有时次的要素。

`数据质量` 摘要会显示风区、路径、预警点数量，并提示缺类型、缺时次、缺显式样式和几何异常，适合检查批量自动化输出是否达到展示要求。点击 `校验` 或调用 `window.weatherEarth.validate()` / `WeatherEarthClient.validate()` 会得到结构化校验结果；`errors` 代表几何或坐标这类会影响展示/交付的硬问题，`warnings` 代表可展示但建议补齐的天气业务字段。点击 `报告` 或调用 `getValidationReport()` 会得到完整 `WeatherEarthValidationReport` JSON，可作为自动化任务的质检附件。

`下载 GeoJSON` 会导出全量当前数据；`下载当前显示` 会导出时次筛选和无时次开关之后的当前显示结果，适合把某个时次的天气元素单独交付给其他系统。

页面侧栏的 `复制分享链接` 会把当前 `map` 视图、远程 `data`/`manifest`/`project` 数据源、`time` 时次筛选和 `untimed=0` 无时次显示状态写入 URL，适合把同一地球状态发给别人复核。

如果当前 GeoJSON 来自本地文件、绘制或文本编辑器，`复制数据链接` 会把小型当前 GeoJSON 直接内联进 URL 的 `data` 参数，别人打开链接即可恢复同一份天气元素。内联链接会自动去掉 `_earthFeatureId`、`_weatherColor`、`marker-size-px` 等页面内部字段；大型风区过程仍建议下载 GeoJSON 或部署为文件 URL 后再分享。

`复制项目链接` 会把当前 `WeatherEarthProject` 内联进 URL 的 `project` 参数，适合发送小型完整工作台状态；大型过程建议点击 `下载项目文档`，把 JSON 部署成 URL 后使用 `project=项目文档地址`。
