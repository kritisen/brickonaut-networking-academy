/* Particle bursts, floating score text, screen shake, flashes. */
(function (ONA) {
  'use strict';
  var canvas, g, parts = [], raf = 0, last = 0, W, H;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    var dpr = ONA.util.canvasDpr(W, H);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function star(cx, cy, r) {
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }

  function loop(t) {
    var dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    g.clearRect(0, 0, W, H);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt / p.ttl;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vx *= 1 - dt * p.drag; p.vy *= 1 - dt * p.drag; p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      g.globalAlpha = Math.min(1, p.life * 1.6);
      g.fillStyle = p.c;
      if (p.shape === 'star') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); star(0, 0, p.r); g.restore(); }
      else if (p.shape === 'ring') {
        g.strokeStyle = p.c; g.lineWidth = 2 * p.life; g.beginPath(); g.arc(p.x, p.y, p.r * (1.6 - p.life) * 3, 0, 6.283); g.stroke();
      } else { g.beginPath(); g.arc(p.x, p.y, p.r * (0.4 + p.life * 0.6), 0, 6.283); g.fill(); }
    }
    g.globalAlpha = 1;
    if (parts.length) raf = requestAnimationFrame(loop); else { raf = 0; last = 0; }
  }

  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  function center(elOrPoint) {
    if (!elOrPoint) return { x: W / 2, y: H / 2 };
    if (elOrPoint.getBoundingClientRect) {
      var b = elOrPoint.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return elOrPoint;
  }

  ONA.fx = {
    init: function (el) { canvas = el; g = canvas.getContext('2d'); resize(); window.addEventListener('resize', resize); },
    burst: function (target, opts) {
      if (ONA.util.reducedMotion()) return;
      opts = opts || {};
      var c = center(target), n = opts.n || 70;
      var colors = opts.colors || ['#7cf7c3', '#4fd1ff', '#f6c453', '#ffffff', '#b794f6'];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, sp = 140 + Math.random() * (opts.power || 520);
        parts.push({
          x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          r: 1.5 + Math.random() * 3.5, c: colors[i % colors.length],
          life: 1, ttl: 0.7 + Math.random() * 0.9, drag: 2.2, grav: 260,
          shape: i % 5 === 0 ? 'star' : 'dot', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12
        });
      }
      parts.push({ x: c.x, y: c.y, vx: 0, vy: 0, r: 30, c: colors[0], life: 1, ttl: 0.55, drag: 0, grav: 0, shape: 'ring', rot: 0, vr: 0 });
      kick();
    },
    sparks: function (target, color) {
      if (ONA.util.reducedMotion()) return;
      var c = center(target);
      for (var i = 0; i < 26; i++) {
        var a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 300;
        parts.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1 + Math.random() * 2, c: color || '#ff4d6d', life: 1, ttl: 0.5 + Math.random() * 0.4, drag: 3, grav: 400, shape: 'dot', rot: 0, vr: 0 });
      }
      kick();
    },
    floatText: function (target, text, cls) {
      var c = center(target);
      var n = ONA.util.el('div', { class: 'float-text ' + (cls || ''), text: text });
      n.style.left = c.x + 'px'; n.style.top = c.y + 'px';
      document.body.appendChild(n);
      setTimeout(function () { n.remove(); }, 1400);
    },
    shake: function (el) {
      if (!el || ONA.util.reducedMotion()) return;
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      setTimeout(function () { el.classList.remove('shake'); }, 600);
    },
    flash: function (kind) {
      var f = document.getElementById('flash');
      if (!f) return;
      f.className = ''; void f.offsetWidth; f.className = 'on ' + kind;
    }
  };
})(window.ONA);
