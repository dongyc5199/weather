# 孟加拉湾逐日强降水验证

检验事件为 UTC 自然日累计降水 ≥25 mm。两组验证都使用独立发布的 NOAA PERSIANN-CDR 卫星降水估计，观测像元中心为 90.125°E、20.125°N。这是单地点、逐日对照。卫星反演误差、空间代表性和模式版本变化会影响结果。[NOAA 产品说明](https://www.ncei.noaa.gov/products/climate-data-records/precipitation-persiann)

| 输入 | 校准期 | 独立检验期 | 原始成员比例 Brier | 校准后 Brier | 训练期气候频率 Brier |
| --- | --- | --- | ---: | ---: | ---: |
| GFS Global + ICON Global，小时量取 previous_day2 | 2024 年，346 个完整日、42 次事件 | 2025 年，365 日、31 次事件 | 0.06301 | **0.05470** | 0.07905 |
| NCEP/NCAR R1 + NCEP/DOE R2 再分析 | 2020–2021 年，731 日、74 次事件 | 2022 年，365 日、31 次事件 | 0.09589 | **0.06811** | 0.07798 |

Brier 分数为概率与实际事件指示值之差的均方，越低越好。完整配置文件中附有逐概率段样本数、事件数、预测均值和实际发生率，便于检查小样本段的偏差。[ECMWF 验证说明](https://confluence.ecmwf.int/pages/viewpage.action?pageId=283544832)

**预报样本。** 查询 Open-Meteo Previous Runs API 的 GFS Global 和 ICON Global，地点 20.125°N、90.125°E，`cell_selection=nearest`、`elevation=nan`、`timezone=GMT`。逐日累加当日 01 UTC 至次日 00 UTC 结束的 24 个小时降水量，各小时使用 `precipitation_previous_day2`，即对相应有效小时提前 48 小时的滚动预报。20 天缺少完整小时而排除。该验证与固定起报时刻的全程预报属于不同的时效口径。[Previous Runs API](https://open-meteo.com/en/docs/previous-runs-api)

**再分析样本。** NOAA PSL 每日平均降水率原单位为 kg/m²/s，读取 Gaussian 网格索引 lat=36、lon=48（19.9997°N、90°E）。两个数据集的日界均为 UTC 00 至次日 00。按日期与最近观测像元配对，乘 86400 换算为日累计毫米。该行指标用于评价再分析估计。[NOAA R1 数据](https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html) · [NOAA R2 数据](https://psl.noaa.gov/data/gridded/data.ncep.reanalysis2.html)

CSV 含逐日配对的实际值，空列表示缺测。两份 site.json 记录数据集、原始单位、位置、来源 URL、变量及取样规则。PERSIANN 使用 ERDDAP 的 precipitation 变量，时间维度以日历日期匹配。[观测数据接口](https://www.ncei.noaa.gov/erddap/griddap/cdr_persiann_by_time_lon_lat.html)

**复算与使用。** 在项目根目录运行以下命令。以原始成员超阈值比例作为校准输入，按训练期各分组的实际频率做单调校准，每组加入相当于十个训练气候频率样本的平滑项。按时间留出整年，训练和检验各至少 90 天且各含至少五个正例、五个反例。只有检验分数同时低于原始比例和训练气候基准，才接受配置。

```sh
weather-geo precipitation-calibrate --history-json examples/rain-verification/forecast-site.json --holdout-start 2025-01-01 --no-bias-correction -o outputs/forecast-calibration.json
weather-geo precipitation-calibrate --history-json examples/rain-verification/site.json --holdout-start 2022-01-01 --no-bias-correction -o outputs/reanalysis-calibration.json
weather-geo precipitation-ensemble --sources-json YOUR_DAILY_MEMBERS.json --no-bias-correction --calibration outputs/forecast-calibration.json -o outputs/rain.geojson
```

新预报成员使用 `dataset=gfs_global` 与 `dataset=icon_global`，均声明 `forecast_offset_hours=48`、`unit=mm`、UTC 日期，以及上面样点的经纬度。单地点配置只在验证期结束后且成员、时效、偏差订正和地点匹配时输出 `prob_heavy_rain`。其他地点或组合可提供各自的历史配对样本，使用相同命令生成独立配置。
