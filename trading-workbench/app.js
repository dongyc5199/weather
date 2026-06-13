// ==========================================
// Mock Data Store
// ==========================================

const mockStocks = {
  "AAPL": {
    name: "Apple Inc.",
    code: "AAPL.US",
    price: 192.45,
    change: 1.12,
    volume: "27.43M",
    prices: [190.1, 189.5, 191.0, 190.8, 192.3, 191.8, 192.45, 192.75, 192.1, 192.9, 193.1, 192.6, 192.45]
  },
  "TSLA": {
    name: "Tesla Inc.",
    code: "TSLA.US",
    price: 176.45,
    change: -2.35,
    volume: "18.59M",
    prices: [181.2, 180.5, 179.3, 177.1, 178.5, 176.8, 176.45, 175.2, 176.9, 175.8, 176.1, 175.4, 176.45]
  },
  "NVDA": {
    name: "NVIDIA Corp.",
    code: "NVDA.US",
    price: 875.12,
    change: 4.20,
    volume: "35.21M",
    prices: [840.1, 842.3, 850.5, 848.2, 855.9, 860.2, 868.5, 871.2, 869.0, 872.4, 875.12, 878.0, 875.12]
  },
  "CCB": {
    name: "建设银行",
    code: "601939.SH",
    price: 7.50,
    change: 1.57,
    volume: "89.4M",
    prices: [7.38, 7.35, 7.42, 7.40, 7.45, 7.48, 7.50, 7.51, 7.49, 7.52, 7.50, 7.53, 7.50]
  },
  "ICBC": {
    name: "工商银行",
    code: "601398.SH",
    price: 6.20,
    change: 1.12,
    volume: "112.5M",
    prices: [6.13, 6.11, 6.16, 6.14, 6.18, 6.19, 6.20, 6.22, 6.21, 6.23, 6.20, 6.24, 6.20]
  },
  "SMIC": {
    name: "中芯国际",
    code: "688981.SH",
    price: 42.30,
    change: -1.98,
    volume: "24.12M",
    prices: [43.15, 43.0, 42.8, 42.5, 42.9, 42.4, 42.30, 42.1, 42.5, 42.0, 42.30, 41.9, 42.30]
  }
};

const mockSectors = [
  { name: "电子/半导体", change: 2.15 },
  { name: "银行/金融", change: 1.48 },
  { name: "电力设备", change: -1.25 },
  { name: "通信设备", change: 0.85 },
  { name: "医药生物", change: -0.92 },
  { name: "汽车整车", change: 1.74 },
  { name: "证券/非银", change: -0.42 },
  { name: "国防军工", change: 0.28 }
];

// ==========================================
// Application State
// ==========================================

let activeSymbol = "AAPL";
let theme = "dark";
let trendColorRule = "china"; // 'china' (Red-Up/Green-Down) or 'international' (Green-Up/Red-Down)
let activeTradeTab = "buy";
let chartCandles = [];

// ==========================================
// Initialization & Event Listeners
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  renderWatchlist();
  renderSectors();
  selectSymbol(activeSymbol);
  setupEventListeners();
  startOrderBookSimulation();
  renderTopIndicesSparklines();
  
  // Trigger initial K-Line draw
  setTimeout(resizeCanvas, 100);
});

// Setup dynamic resizing
window.addEventListener("resize", () => {
  resizeCanvas();
  renderTopIndicesSparklines();
  // Redraw stock rows sparklines
  Object.keys(mockStocks).forEach(symbol => {
    drawSparkline(`row-spark-${symbol}`, mockStocks[symbol].prices, mockStocks[symbol].change >= 0);
  });
});

// Initialize body classes and button state
function initTheme() {
  document.body.className = `theme-${theme} trend-${trendColorRule}`;
  updateThemeButtonUI();
  updateTrendButtonUI();
}

function updateThemeButtonUI() {
  const btn = document.getElementById("btn-theme-toggle");
  if (theme === "dark") {
    btn.innerHTML = "<span>🌙</span> 暗色模式";
    btn.classList.add("active");
  } else {
    btn.innerHTML = "<span>☀️</span> 亮色模式";
    btn.classList.remove("active");
  }
}

function updateTrendButtonUI() {
  const btn = document.getElementById("btn-trend-toggle");
  if (trendColorRule === "china") {
    btn.innerHTML = "<span>🔴</span> 红涨绿跌 (A股)";
    btn.classList.add("active");
  } else {
    btn.innerHTML = "<span>🟢</span> 绿涨红跌 (国际)";
    btn.classList.remove("active");
  }
}

function setupEventListeners() {
  // Theme Toggle
  document.getElementById("btn-theme-toggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    document.body.classList.remove("theme-dark", "theme-light");
    document.body.classList.add(`theme-${theme}`);
    updateThemeButtonUI();
    
    // Refresh Canvas Drawings with new theme colors
    drawKline();
    redrawSectorHeatmap();
    renderTopIndicesSparklines();
  });

  // Trend Color Rule Toggle
  document.getElementById("btn-trend-toggle").addEventListener("click", () => {
    trendColorRule = trendColorRule === "china" ? "international" : "china";
    document.body.classList.remove("trend-china", "trend-international");
    document.body.classList.add(`trend-${trendColorRule}`);
    updateTrendButtonUI();
    
    // Refresh colors globally
    drawKline();
    renderWatchlist();
    redrawSectorHeatmap();
    updateOrderBookUI();
    renderTopIndicesSparklines();
  });

  // Trade Panel Buy/Sell Toggle
  const btnBuy = document.getElementById("btn-trade-buy");
  const btnSell = document.getElementById("btn-trade-sell");
  const btnSubmit = document.getElementById("btn-submit-order");

  btnBuy.addEventListener("click", () => {
    activeTradeTab = "buy";
    btnBuy.classList.add("active");
    btnSell.classList.remove("active");
    btnSubmit.className = "trade-action-btn buy";
    btnSubmit.innerText = "买入限制单 (Buy Limit)";
  });

  btnSell.addEventListener("click", () => {
    activeTradeTab = "sell";
    btnSell.classList.add("active");
    btnBuy.classList.remove("active");
    btnSubmit.className = "trade-action-btn sell";
    btnSubmit.innerText = "卖出限制单 (Sell Limit)";
  });

  // Price/Size controls
  setupInputStepper("trade-input-price", "btn-price-minus", "btn-price-plus", 0.05);
  setupInputStepper("trade-input-size", "btn-size-minus", "btn-size-plus", 100);

  // Submit Order Button
  btnSubmit.addEventListener("click", () => {
    const symbol = activeSymbol;
    const price = parseFloat(document.getElementById("trade-input-price").value);
    const size = parseInt(document.getElementById("trade-input-size").value);
    
    showToast(
      `${activeTradeTab === "buy" ? "买单" : "卖单"}已提交`,
      `${symbol} @ ${price.toFixed(2)} x ${size} 股 成功进入队列。`,
      activeTradeTab === "buy" ? "success" : "error"
    );
  });

  // Interval controls
  document.querySelectorAll(".chart-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".chart-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      
      // Simulate switching chart interval with new random candles
      generateMockCandles(mockStocks[activeSymbol]);
      drawKline();
      showToast("周期切换", `已载入 ${activeSymbol} ${e.target.innerText}数据走势`, "success");
    });
  });
}

function setupInputStepper(inputId, minusId, plusId, step) {
  const input = document.getElementById(inputId);
  document.getElementById(minusId).addEventListener("click", () => {
    const val = Math.max(0, parseFloat(input.value) - step);
    input.value = step < 1 ? val.toFixed(2) : val;
  });
  document.getElementById(plusId).addEventListener("click", () => {
    const val = parseFloat(input.value) + step;
    input.value = step < 1 ? val.toFixed(2) : val;
  });
}

// ==========================================
// Watchlist & Heatmap Render
// ==========================================

function renderWatchlist() {
  const tbody = document.getElementById("watchlist-body");
  tbody.innerHTML = "";
  
  Object.keys(mockStocks).forEach(symbol => {
    const stock = mockStocks[symbol];
    const isUp = stock.change >= 0;
    const trendClass = isUp ? "text-up" : "text-down";
    const changeStr = (isUp ? "+" : "") + stock.change.toFixed(2) + "%";
    
    const row = document.createElement("tr");
    row.className = `watchlist-row ${symbol === activeSymbol ? "selected" : ""}`;
    row.id = `row-${symbol}`;
    row.innerHTML = `
      <td>
        <div class="watchlist-name">${stock.name}</div>
        <div class="watchlist-code">${stock.code}</div>
      </td>
      <td class="watchlist-price">${stock.price.toFixed(2)}</td>
      <td class="watchlist-change ${trendClass}">${changeStr}</td>
      <td class="watchlist-cell-spark">
        <canvas id="row-spark-${symbol}" class="watchlist-row-sparkline"></canvas>
      </td>
    `;
    
    row.addEventListener("click", () => {
      selectSymbol(symbol);
    });
    tbody.appendChild(row);
    
    // Draw sparkline asynchronously to ensure DOM is ready
    setTimeout(() => {
      drawSparkline(`row-spark-${symbol}`, stock.prices, isUp);
    }, 10);
  });
}

function renderSectors() {
  const container = document.getElementById("sector-heatmap-container");
  container.innerHTML = "";
  
  mockSectors.forEach(sector => {
    const isUp = sector.change >= 0;
    
    // Muted background colors depending on change
    // Using simple styling rather than hardcoded hex inline, but since background colors need scaling,
    // we use clean opacity-based styling using class helpers or custom inline styles with CSS variables
    const opacity = Math.min(1.0, Math.max(0.3, Math.abs(sector.change) / 2.5));
    const bgStyle = isUp 
      ? `background-color: rgba(16, 185, 129, ${opacity * 0.8})` // Muted emerald green
      : `background-color: rgba(239, 68, 68, ${opacity * 0.8})`;  // Muted red
      
    const card = document.createElement("div");
    card.className = "sector-card";
    card.style = bgStyle;
    card.innerHTML = `
      <span class="sector-name">${sector.name}</span>
      <span class="sector-change">${isUp ? "+" : ""}${sector.change.toFixed(2)}%</span>
    `;
    
    card.addEventListener("click", () => {
      showToast("板块点击", `您查看了板块 [${sector.name}]，涨跌幅为 ${sector.change}%`, "success");
    });
    
    container.appendChild(card);
  });
}

function redrawSectorHeatmap() {
  renderSectors();
}

// ==========================================
// Sparkline Renderer (Canvas)
// ==========================================

function drawSparkline(canvasId, data, isUp) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  
  ctx.clearRect(0, 0, rect.width, rect.height);
  
  if (data.length < 2) return;
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  // Get dynamic colors from CSS variables
  const colorStr = getComputedStyle(document.body).getPropertyValue(isUp ? '--color-trend-up' : '--color-trend-down').trim();
  
  ctx.beginPath();
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.strokeStyle = colorStr || (isUp ? "#10b981" : "#ef4444");
  
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * rect.width;
    const y = rect.height - ((data[i] - min) / range) * (rect.height - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function renderTopIndicesSparklines() {
  const ids = ["000001", "399901", "399906", "000688"]; // maps to indices
  
  // Mock trend data for indices
  const dataMap = {
    "000001": [4010, 4015, 4012, 4022, 4018, 4026, 4031],
    "399901": [14850, 14920, 14900, 14950, 14930, 14960, 14963],
    "399906": [3810, 3815, 3812, 3822, 3818, 3828, 3830],
    "000688": [1660, 1662, 1661, 1664, 1663, 1665, 1663]
  };
  
  drawSparkline("spark-000001", dataMap["000001"], true);
  drawSparkline("spark-399001", dataMap["399901"], true);
  drawSparkline("spark-399006", dataMap["399906"], true);
  drawSparkline("spark-000688", dataMap["000688"], true);
}

// ==========================================
// Active Symbol Controller & Linking
// ==========================================

function selectSymbol(symbol) {
  if (!mockStocks[symbol]) return;
  activeSymbol = symbol;
  
  // Update selected class in watchlist
  document.querySelectorAll(".watchlist-row").forEach(row => {
    row.classList.remove("selected");
  });
  const row = document.getElementById(`row-${symbol}`);
  if (row) row.classList.add("selected");
  
  // Linkages:
  // 1. Update Chart Legend & details
  document.getElementById("legend-symbol").innerText = mockStocks[symbol].code;
  
  // 2. Generate new chart candles and draw
  generateMockCandles(mockStocks[symbol]);
  drawKline();
  
  // 3. Update Order Book content
  updateOrderBookUI();
  
  // 4. Update Trade Input prices
  document.getElementById("trade-input-price").value = mockStocks[symbol].price.toFixed(2);
  
  // Symbol link feedback
  showToast("标的色彩链同步", `已成功同步联动: ${symbol} 的走势图与盘口数据`, "success");
}

// ==========================================
// Mock K-Line Candle Generator
// ==========================================

function generateMockCandles(stock) {
  chartCandles = [];
  const basePrice = stock.price;
  const steps = 40;
  let currentPrice = basePrice - (stock.change * 0.01 * basePrice * 0.5); // Start lower if price rose
  
  const seed = stock.prices;
  
  for (let i = 0; i < steps; i++) {
    // Generate organic-looking candle walk
    const change = (Math.random() - 0.48) * (basePrice * 0.006);
    const open = currentPrice;
    const close = currentPrice + change;
    const high = Math.max(open, close) + (Math.random() * (basePrice * 0.003));
    const low = Math.min(open, close) - (Math.random() * (basePrice * 0.003));
    const volume = Math.round(1000 + Math.random() * 50000);
    
    chartCandles.push({ open, close, high, low, volume });
    currentPrice = close;
  }
  
  // Update Legend with final candle details
  const final = chartCandles[chartCandles.length - 1];
  updateLegend(final);
}

function updateLegend(candle) {
  document.getElementById("legend-open").innerText = candle.open.toFixed(2);
  document.getElementById("legend-high").innerText = candle.high.toFixed(2);
  document.getElementById("legend-low").innerText = candle.low.toFixed(2);
  document.getElementById("legend-close").innerText = candle.close.toFixed(2);
  document.getElementById("legend-volume").innerText = candle.volume.toLocaleString();
  
  const isUp = candle.close >= candle.open;
  const legendClose = document.getElementById("legend-close");
  legendClose.className = isUp ? "text-up" : "text-down";
}

// ==========================================
// Candlestick K-Line Canvas Renderer
// ==========================================

function resizeCanvas() {
  const canvas = document.getElementById("kline-canvas");
  if (!canvas) return;
  
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth;
  const h = container.clientHeight;
  
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  
  drawKline();
}

function drawKline() {
  const canvas = document.getElementById("kline-canvas");
  if (!canvas || chartCandles.length === 0) return;
  
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  
  // Retrieve color tokens from CSS variables
  const style = getComputedStyle(document.body);
  const colorBg = style.getPropertyValue('--color-bg-panel').trim();
  const colorBorder = style.getPropertyValue('--color-border-subtle').trim();
  const colorTextSecondary = style.getPropertyValue('--color-text-secondary').trim();
  const colorUp = style.getPropertyValue('--color-trend-up').trim();
  const colorDown = style.getPropertyValue('--color-trend-down').trim();
  
  // Chart geometry padding
  const paddingLeft = 12;
  const paddingRight = 60; // Y axis space
  const paddingTop = 40;
  const paddingBottom = 40; // X axis & Volume space
  
  const graphWidth = w - paddingLeft - paddingRight;
  const graphHeight = h - paddingTop - paddingBottom;
  
  // Find Min / Max prices
  let maxPrice = -Infinity;
  let minPrice = Infinity;
  let maxVol = 0;
  
  chartCandles.forEach(c => {
    if (c.high > maxPrice) maxPrice = c.high;
    if (c.low < minPrice) minPrice = c.low;
    if (c.volume > maxVol) maxVol = c.volume;
  });
  
  const priceRange = maxPrice - minPrice || 1;
  
  // Grid Lines
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = colorBorder;
  ctx.fillStyle = colorTextSecondary;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  
  // Horizontal grid lines
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const price = maxPrice - (i / gridLines) * priceRange;
    const y = paddingTop + (i / gridLines) * graphHeight;
    
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(w - paddingRight, y);
    ctx.stroke();
    
    // Draw Y axis labels
    ctx.fillText(price.toFixed(2), w - paddingRight + 6, y + 3);
  }
  
  // Draw Candles
  const candleCount = chartCandles.length;
  const candleWidth = (graphWidth / candleCount) * 0.7;
  const spacing = graphWidth / candleCount;
  
  chartCandles.forEach((c, idx) => {
    const x = paddingLeft + (idx * spacing) + (spacing * 0.15);
    const yOpen = paddingTop + graphHeight - ((c.open - minPrice) / priceRange) * graphHeight;
    const yClose = paddingTop + graphHeight - ((c.close - minPrice) / priceRange) * graphHeight;
    const yHigh = paddingTop + graphHeight - ((c.high - minPrice) / priceRange) * graphHeight;
    const yLow = paddingTop + graphHeight - ((c.low - minPrice) / priceRange) * graphHeight;
    
    const isUp = c.close >= c.open;
    const candleColor = isUp ? colorUp : colorDown;
    
    ctx.strokeStyle = candleColor;
    ctx.fillStyle = candleColor;
    ctx.lineWidth = 1.2;
    
    // 1. Draw wick (line from low to high)
    ctx.beginPath();
    ctx.moveTo(x + candleWidth / 2, yHigh);
    ctx.lineTo(x + candleWidth / 2, yLow);
    ctx.stroke();
    
    // 2. Draw body (rect)
    const rectH = Math.abs(yClose - yOpen) || 1;
    const rectY = Math.min(yOpen, yClose);
    
    // Professional hollow candles for green/up in classic charting if preferred, 
    // but here we use sleek filled solid rectangles for standard UI aesthetics.
    ctx.fillRect(x, rectY, candleWidth, rectH);
    
    // 3. Draw Volume bars at the bottom
    const volHeight = (c.volume / maxVol) * 30; // Max 30px height
    const volY = h - 16 - volHeight;
    
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, volY, candleWidth, volHeight);
    ctx.globalAlpha = 1.0;
  });
  
  // Draw X-Axis labels
  ctx.textAlign = "center";
  ctx.fillText("13:45", paddingLeft + spacing * 3, h - 6);
  ctx.fillText("13:50", paddingLeft + spacing * 13, h - 6);
  ctx.fillText("13:55", paddingLeft + spacing * 23, h - 6);
  ctx.fillText("14:00", paddingLeft + spacing * 33, h - 6);
  
  ctx.restore();
}

// ==========================================
// Order Book & Tick Simulation
// ==========================================

function updateOrderBookUI() {
  const symbol = activeSymbol;
  const stock = mockStocks[symbol];
  if (!stock) return;
  
  const midPrice = stock.price;
  const container = document.getElementById("orderbook-levels");
  container.innerHTML = "";
  
  const levelsCount = 5;
  const spread = midPrice * 0.0003; // Mock spread
  
  // Generating Ask 5 (high) to Ask 1 (low)
  const asks = [];
  for (let i = levelsCount; i >= 1; i--) {
    asks.push({
      label: `卖 ${i}`,
      price: midPrice + (spread * 0.5) + (i - 1) * (midPrice * 0.0001),
      size: Math.round(10 + Math.random() * 200)
    });
  }
  
  // Generating Bid 1 (high) to Bid 5 (low)
  const bids = [];
  for (let i = 1; i <= levelsCount; i++) {
    bids.push({
      label: `买 ${i}`,
      price: midPrice - (spread * 0.5) - (i - 1) * (midPrice * 0.0001),
      size: Math.round(10 + Math.random() * 200)
    });
  }
  
  // Ask levels (Red text)
  const style = getComputedStyle(document.body);
  const colorDown = style.getPropertyValue('--color-trend-down').trim();
  const colorUp = style.getPropertyValue('--color-trend-up').trim();
  
  asks.forEach(ask => {
    const row = createOrderBookRow(ask, "text-down", colorDown);
    container.appendChild(row);
  });
  
  // Spread Bar
  const spreadBar = document.createElement("div");
  spreadBar.className = "ob-spread-bar";
  spreadBar.innerHTML = `
    <span>点差 (Spread)</span>
    <span class="ob-spread-val">${(spread).toFixed(2)}</span>
  `;
  container.appendChild(spreadBar);
  
  // Bid levels (Green text)
  bids.forEach(bid => {
    const row = createOrderBookRow(bid, "text-up", colorUp);
    container.appendChild(row);
  });
}

function createOrderBookRow(level, textClass, hexColor) {
  const row = document.createElement("div");
  row.className = "ob-row";
  
  // Size-based background bar
  const maxBarSize = 250;
  const fillPercent = Math.min(100, (level.size / maxBarSize) * 100);
  
  // Clean color overlay opacity bar
  const overlayStyle = `width: ${fillPercent}%; background-color: ${hexColor};`;
  
  row.innerHTML = `
    <div class="ob-level-bg" style="${overlayStyle}"></div>
    <span class="ob-label">${level.label}</span>
    <span class="ob-price ${textClass}">${level.price.toFixed(2)}</span>
    <span class="ob-size">${level.size}</span>
  `;
  
  // Click handler: Auto-fills price in trade console!
  row.addEventListener("click", () => {
    document.getElementById("trade-input-price").value = level.price.toFixed(2);
    showToast("自动填单", `已自动代入价格: ${level.price.toFixed(2)}`, "success");
  });
  
  return row;
}

function startOrderBookSimulation() {
  // Simulates price ticks and updates L2 depth sizes dynamically
  setInterval(() => {
    if (!mockStocks[activeSymbol]) return;
    
    // Add random tick noise to price
    const stock = mockStocks[activeSymbol];
    const tick = (Math.random() - 0.5) * (stock.price * 0.0004);
    stock.price += tick;
    
    // Update active row price text dynamically in watchlist
    const row = document.getElementById(`row-${activeSymbol}`);
    if (row) {
      row.querySelector(".watchlist-price").innerText = stock.price.toFixed(2);
    }
    
    // Also push new close to prices array
    stock.prices.shift();
    stock.prices.push(stock.price);
    
    // Redraw K-line final candle close
    const finalCandle = chartCandles[chartCandles.length - 1];
    if (finalCandle) {
      finalCandle.close = stock.price;
      if (stock.price > finalCandle.high) finalCandle.high = stock.price;
      if (stock.price < finalCandle.low) finalCandle.low = stock.price;
      updateLegend(finalCandle);
      drawKline();
    }
    
    // Refresh Order Book
    updateOrderBookUI();
  }, 1200);
}

// ==========================================
// Toast Notification Utility
// ==========================================

function showToast(title, desc, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-title">${title}</span>
    <span class="toast-desc">${desc}</span>
  `;
  
  container.appendChild(toast);
  
  // Slide out and destroy after 3s
  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s ease reverse forwards";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}
