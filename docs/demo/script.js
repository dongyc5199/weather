/* 点击地球取点：移动十字准线、涟漪、读数卡。
   注意：读数是按位置估算的演示值，接入真实数据时替换 sample()。 */
(function () {
  var VB = 680, CX = 340, CY = 340, R = 318;
  var svg = document.getElementById('globe');
  var probe = document.getElementById('probe');
  var cross = document.getElementById('probe-g');
  var ripple = document.getElementById('ripple');
  var out = {
    pos: document.getElementById('v-pos'),
    spd: document.getElementById('v-spd'),
    dir: document.getElementById('v-dir'),
    hgt: document.getElementById('v-hgt'),
    tmp: document.getElementById('v-tmp')
  };
  var names = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

  // 演示数据：急流带（约 38°N）风速最大，低纬为东风
  function sample(px, py) {
    var lat = Math.max(-90, Math.min(90, 25 + (CY - py) / R * 65));
    var lon = 85 + (px - CX) / R * 95;
    var jet = Math.exp(-Math.pow((lat - 38) / 13, 2));
    var d = lat < 18 ? 80 + 10 * Math.sin(lon / 10) : 250 + 40 * jet + 12 * Math.sin(lon / 14);
    var dir = Math.round(((d % 360) + 360) % 360);
    var ew = (lon + 540) % 360 - 180;
    return {
      pos: Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(ew).toFixed(1) + '°' + (ew >= 0 ? 'E' : 'W'),
      spd: Math.round(25 + 175 * jet + 12 * Math.sin(lon / 9)),
      dir: names[Math.round(dir / 22.5) % 16] + ' ' + dir + '°',
      hgt: Math.round((5900 - Math.max(0, lat - 5) * 10.5 + 15 * Math.sin(lon / 12)) / 10) * 10,
      tmp: Math.round(-8 - lat * 0.55)
    };
  }

  function show(px, py, animate) {
    var s = sample(px, py);
    out.pos.textContent = s.pos;
    out.spd.textContent = s.spd;
    out.dir.textContent = s.dir;
    out.hgt.textContent = s.hgt;
    out.tmp.textContent = s.tmp;
    cross.style.transform = 'translate(' + (px - 440) + 'px,' + (py - 312) + 'px)';
    probe.style.left = (px / VB * 100) + '%';
    probe.style.top = (py / VB * 100) + '%';
    probe.classList.toggle('flip', px > 440);
    if (animate) {
      ripple.style.animation = 'none';
      void ripple.getBoundingClientRect();
      ripple.style.animation = 'ripple .8s ease-out';
    }
  }

  svg.addEventListener('click', function (e) {
    var r = svg.getBoundingClientRect();
    var px = (e.clientX - r.left) * VB / r.width;
    var py = (e.clientY - r.top) * VB / r.height;
    if ((px - CX) * (px - CX) + (py - CY) * (py - CY) > R * R) return;
    show(px, py, true);
  });

  show(440, 312, false);
})();
