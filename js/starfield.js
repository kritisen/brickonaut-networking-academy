/* Parallax starfield + nebula backdrop (canvas). Supports warp bursts and a danger tint. */
(function (ONA) {
  'use strict';
  var canvas, g, W, H, DPR, nebula, stars = [], shooting = [], raf = 0, last = 0;
  var speed = 1, targetSpeed = 1, mouseX = 0, mouseY = 0, px = 0, py = 0, tint = null, tintTarget = 0, tintA = 0;
  var LAYERS = [
    { n: 260, size: [0.4, 1.0], speed: 6, alpha: [0.25, 0.6], par: 6 },
    { n: 140, size: [0.8, 1.6], speed: 16, alpha: [0.45, 0.85], par: 16 },
    { n: 50, size: [1.4, 2.4], speed: 38, alpha: [0.7, 1], par: 34 }
  ];
  var HUES = ['#ffffff', '#cfe8ff', '#ffe9c4', '#c9d6ff', '#a6f0ff'];

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function buildNebula() {
    nebula = document.createElement('canvas');
    nebula.width = Math.ceil(W / 2); nebula.height = Math.ceil(H / 2);
    var n = nebula.getContext('2d'), w = nebula.width, h = nebula.height;
    var base = n.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, '#060a1f'); base.addColorStop(0.5, '#070b22'); base.addColorStop(1, '#0a0a26');
    n.fillStyle = base; n.fillRect(0, 0, w, h);
    var clouds = [
      [0.18, 0.28, 0.55, 'rgba(70,40,160,0.30)'], [0.78, 0.2, 0.5, 'rgba(20,110,170,0.26)'],
      [0.62, 0.82, 0.6, 'rgba(150,40,120,0.20)'], [0.3, 0.75, 0.4, 'rgba(20,140,150,0.16)'],
      [0.92, 0.6, 0.35, 'rgba(90,60,200,0.18)']
    ];
    clouds.forEach(function (c) {
      var r = c[2] * Math.max(w, h);
      var gr = n.createRadialGradient(c[0] * w, c[1] * h, 0, c[0] * w, c[1] * h, r);
      gr.addColorStop(0, c[3]); gr.addColorStop(1, 'rgba(0,0,0,0)');
      n.fillStyle = gr; n.fillRect(0, 0, w, h);
    });
    // dust speckle
    for (var i = 0; i < 900; i++) {
      n.fillStyle = 'rgba(255,255,255,' + rnd(0.02, 0.09) + ')';
      n.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
  }

  function buildStars() {
    stars = [];
    LAYERS.forEach(function (L, li) {
      var count = Math.round(L.n * (W * H) / (1440 * 900));
      for (var i = 0; i < count; i++) stars.push({
        x: Math.random() * W, y: Math.random() * H, layer: li,
        r: rnd(L.size[0], L.size[1]), a: rnd(L.alpha[0], L.alpha[1]),
        tw: Math.random() * Math.PI * 2, tws: rnd(0.6, 2.2),
        c: HUES[Math.floor(Math.random() * HUES.length)]
      });
    });
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = ONA.util.canvasDpr(W, H);
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildNebula(); buildStars();
    if (ONA.util.reducedMotion()) draw(0);
  }

  function draw(dt) {
    speed += (targetSpeed - speed) * Math.min(1, dt * 3);
    px += (mouseX - px) * Math.min(1, dt * 2); py += (mouseY - py) * Math.min(1, dt * 2);
    tintA += (tintTarget - tintA) * Math.min(1, dt * 4);
    g.globalAlpha = 1;
    g.drawImage(nebula, 0, 0, W, H);
    var warp = speed > 3;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i], L = LAYERS[s.layer];
      s.x -= L.speed * speed * dt;
      if (s.x < -10) { s.x = W + 10; s.y = Math.random() * H; }
      s.tw += s.tws * dt;
      var x = s.x + px * L.par, y = s.y + py * L.par;
      var a = s.a * (0.75 + 0.25 * Math.sin(s.tw));
      g.globalAlpha = a; g.fillStyle = s.c;
      if (warp) {
        var len = Math.min(220, L.speed * speed * 0.09 * (s.layer + 1));
        g.strokeStyle = s.c; g.lineWidth = s.r; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.stroke();
      } else {
        g.beginPath(); g.arc(x, y, s.r, 0, 6.283); g.fill();
        if (s.r > 1.7) { g.globalAlpha = a * 0.18; g.beginPath(); g.arc(x, y, s.r * 3.2, 0, 6.283); g.fill(); }
      }
    }
    // shooting stars
    if (!warp && Math.random() < dt * 0.12) shooting.push({ x: rnd(W * 0.3, W * 1.1), y: rnd(-20, H * 0.4), vx: -rnd(500, 800), vy: rnd(160, 300), life: 1 });
    for (var j = shooting.length - 1; j >= 0; j--) {
      var sh = shooting[j];
      sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.life -= dt * 0.9;
      if (sh.life <= 0) { shooting.splice(j, 1); continue; }
      var gr = g.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * 0.12, sh.y - sh.vy * 0.12);
      gr.addColorStop(0, 'rgba(255,255,255,' + sh.life + ')'); gr.addColorStop(1, 'rgba(120,200,255,0)');
      g.globalAlpha = 1; g.strokeStyle = gr; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(sh.x, sh.y); g.lineTo(sh.x - sh.vx * 0.12, sh.y - sh.vy * 0.12); g.stroke();
    }
    if (tintA > 0.01 && tint) {
      g.globalAlpha = tintA;
      var vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, tint);
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }
    g.globalAlpha = 1;
  }

  function loop(t) {
    var dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    draw(dt);
    raf = requestAnimationFrame(loop);
  }

  ONA.starfield = {
    init: function (el) {
      canvas = el; g = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
      window.addEventListener('pointermove', function (e) {
        mouseX = (e.clientX / W - 0.5) * -1; mouseY = (e.clientY / H - 0.5) * -1;
      });
      this.motion();
    },
    motion: function () {
      cancelAnimationFrame(raf); raf = 0; last = 0;
      if (ONA.util.reducedMotion()) { speed = targetSpeed = 1; draw(0); }
      else raf = requestAnimationFrame(loop);
    },
    warp: function (ms) {
      if (ONA.util.reducedMotion()) return;
      targetSpeed = 38;
      setTimeout(function () { targetSpeed = 1; }, ms || 900);
    },
    cruise: function (v) { targetSpeed = v || 1; },
    isDanger: function () { return tintTarget > 0; },
    danger: function (on, color) { tint = color || 'rgba(255,40,80,0.55)'; tintTarget = on ? 1 : 0; if (ONA.util.reducedMotion()) { tintA = tintTarget; draw(0); } }
  };
})(window.ONA);
