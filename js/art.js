/* Hand-crafted SVG art: planets/worlds, the cadet ship, commander portraits, network icons.
 * Every function returns an SVG markup string. `u` is a unique suffix so gradient ids never collide. */
(function (ONA) {
  'use strict';
  var A = (ONA.art = {});
  var n = 0;
  function uid() { return 'a' + (++n); }

  // Shared sphere shading: lit from top-left, terminator bottom-right, rim light, atmosphere glow.
  function sphere(u, r, glow, rim) {
    return {
      defs:
        '<radialGradient id="glow' + u + '" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="' + glow + '" stop-opacity="0.55"/><stop offset="72%" stop-color="' + glow + '" stop-opacity="0.18"/><stop offset="100%" stop-color="' + glow + '" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="shade' + u + '" cx="32%" cy="28%" r="80%"><stop offset="0%" stop-color="#fff" stop-opacity="0.28"/><stop offset="38%" stop-color="#fff" stop-opacity="0"/><stop offset="70%" stop-color="#000" stop-opacity="0.35"/><stop offset="100%" stop-color="#000" stop-opacity="0.85"/></radialGradient>' +
        '<clipPath id="clip' + u + '"><circle r="' + r + '"/></clipPath>',
      glow: '<circle r="' + (r * 1.42) + '" fill="url(#glow' + u + ')"/>',
      shade: '<circle r="' + r + '" fill="url(#shade' + u + ')"/>' +
        '<circle r="' + (r - 0.8) + '" fill="none" stroke="' + (rim || glow) + '" stroke-opacity="0.55" stroke-width="1.6"/>'
    };
  }

  function wrapSvg(body, cls, vb) {
    return '<svg class="art ' + (cls || '') + '" viewBox="' + (vb || '-110 -110 220 220') + '" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  // Surface strip repeated twice so a translateX loop looks like rotation.
  function strip(u, w, content, cls) {
    return '<g clip-path="url(#clip' + u + ')"><g class="spin ' + (cls || '') + '" style="--w:' + w + 'px">' +
      '<g>' + content + '</g><g transform="translate(' + w + ' 0)">' + content + '</g></g></g>';
  }

  A.planet = function (kind) {
    var f = A.worlds[kind] || A.worlds.earth;
    return f(uid());
  };

  A.worlds = {
    earth: function (u) {
      var s = sphere(u, 70, '#4fd1ff', '#9be7ff');
      var land = '<path d="M-90-30c12-14 30-18 44-8s8 26-6 32-18 22-34 14-16-26-4-38z" fill="#36b37e"/>' +
        '<path d="M-20-58c10-6 30-4 36 8s-6 20-18 18-26-14-18-26z" fill="#2fa36f"/>' +
        '<path d="M10 10c14-8 40-6 46 10s-8 40-26 38-22-18-30-26 0-18 10-22z" fill="#3cc184"/>' +
        '<path d="M60-40c8-4 22 0 24 10s-10 14-18 10-12-16-6-20z" fill="#2b9a66"/>' +
        '<path d="M-60 40c8-4 18 0 18 8s-10 10-16 6-8-10-2-14z" fill="#38b57f"/>' +
        '';
      var clouds = '<path d="M-80-10c10-4 26-2 30 4s-16 6-30 2z" fill="#fff" opacity=".55"/>' +
        '<path d="M0 30c14-6 34-4 40 2s-22 8-40 4z" fill="#fff" opacity=".5"/>' +
        '<path d="M40-28c10-4 24-2 26 2s-14 6-26 2z" fill="#fff" opacity=".5"/>' +
        '<path d="M-40-48c8-3 20-2 22 2s-12 5-22 2z" fill="#fff" opacity=".45"/>';
      return wrapSvg('<defs>' + s.defs +
        '<radialGradient id="sea' + u + '" cx="35%" cy="30%" r="80%"><stop offset="0%" stop-color="#3aa0ff"/><stop offset="60%" stop-color="#1557b8"/><stop offset="100%" stop-color="#0a2463"/></radialGradient></defs>' +
        s.glow + '<circle r="70" fill="url(#sea' + u + ')"/>' + strip(u, 190, land, 'slow') + strip(u, 190, clouds, 'fast') +
        '<g clip-path="url(#clip' + u + ')"><ellipse cy="-74" rx="46" ry="16" fill="#eef8ff" opacity=".85"/><ellipse cy="76" rx="40" ry="14" fill="#eef8ff" opacity=".7"/></g>' + s.shade +
        // launch pad tower light
        '<circle cx="-30" cy="-62" r="2.4" fill="#fff" class="blink"/>', 'earth');
    },
    station: function (u) {
      return wrapSvg('<defs>' +
        '<radialGradient id="glow' + u + '"><stop offset="40%" stop-color="#7cf7c3" stop-opacity=".35"/><stop offset="100%" stop-color="#7cf7c3" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="hull' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6ecff"/><stop offset=".5" stop-color="#8d9bc7"/><stop offset="1" stop-color="#2c3566"/></linearGradient>' +
        '<linearGradient id="pan' + u + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c6bd6"/><stop offset="1" stop-color="#0d2b6b"/></linearGradient>' +
        '<pattern id="cells' + u + '" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="url(#pan' + u + ')"/><path d="M8 0H0V8" fill="none" stroke="#7fb2ff" stroke-opacity=".5" stroke-width=".8"/></pattern></defs>' +
        '<circle r="105" fill="url(#glow' + u + ')"/>' +
        '<g class="orbit-spin">' +
        '<ellipse rx="88" ry="30" fill="none" stroke="#3a4680" stroke-width="12"/>' +
        '<ellipse rx="88" ry="30" fill="none" stroke="url(#hull' + u + ')" stroke-width="8"/>' +
        '<ellipse rx="88" ry="30" fill="none" stroke="#7cf7c3" stroke-width="1.2" stroke-dasharray="3 9" class="dash-run"/>' +
        '</g>' +
        '<path d="M-88 0H88M0-30V30" stroke="#8d9bc7" stroke-width="3"/>' +
        '<rect x="-100" y="-62" width="44" height="22" fill="url(#cells' + u + ')" stroke="#9fc1ff" stroke-width="1" transform="rotate(-8)"/>' +
        '<rect x="56" y="40" width="44" height="22" fill="url(#cells' + u + ')" stroke="#9fc1ff" stroke-width="1" transform="rotate(-8)"/>' +
        '<path d="M-60-46l30 20M60 46L30 26" stroke="#8d9bc7" stroke-width="2"/>' +
        '<circle r="24" fill="url(#hull' + u + ')" stroke="#c7d2fe" stroke-width="1.5"/>' +
        '<rect x="-8" y="-50" width="16" height="26" rx="3" fill="url(#hull' + u + ')"/>' +
        '<path d="M0-50v-14" stroke="#c7d2fe" stroke-width="2"/><circle cy="-66" r="3" fill="#7cf7c3" class="blink"/>' +
        '<circle r="9" fill="#0b1030" stroke="#7cf7c3" stroke-width="2"/><circle r="4" fill="#7cf7c3" class="pulse"/>' +
        '<circle cx="-88" r="3" fill="#ff4d6d" class="blink"/><circle cx="88" r="3" fill="#7cf7c3" class="blink d2"/>', 'station');
    },
    moon: function (u) {
      var s = sphere(u, 66, '#c7d2fe', '#ffffff');
      var craters = [[-30, -20, 14], [20, 22, 18], [34, -30, 9], [-14, 34, 8], [-46, 14, 6], [52, 6, 7], [-4, -46, 6], [70, -10, 10], [110, 30, 12], [90, -40, 8]];
      var cr = craters.map(function (c) {
        return '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="#8790ad"/><circle cx="' + (c[0] + c[2] * 0.18) + '" cy="' + (c[1] + c[2] * 0.18) + '" r="' + c[2] * 0.82 + '" fill="#a2abc8"/>';
      }).join('') + '<path d="M-70 40c30-8 60 10 100-4s50-6 70 0v40h-170z" fill="#9aa2bf" opacity=".5"/>';
      return wrapSvg('<defs>' + s.defs + '<radialGradient id="rock' + u + '" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#e5e9f5"/><stop offset=".6" stop-color="#a7afc9"/><stop offset="1" stop-color="#5c6385"/></radialGradient>' +
        '<radialGradient id="dome' + u + '" cx="40%" cy="30%"><stop offset="0" stop-color="#e0fbff"/><stop offset="1" stop-color="#4fd1ff" stop-opacity=".6"/></radialGradient></defs>' +
        s.glow + '<circle r="66" fill="url(#rock' + u + ')"/>' + strip(u, 180, cr, 'slow') + s.shade +
        // Tranquility gateway dome on the limb
        '<g transform="translate(-6 -62)"><path d="M-22 4a22 18 0 0 1 44 0z" fill="url(#dome' + u + ')" stroke="#e0fbff" stroke-width="1.2"/>' +
        '<path d="M-14 4v-8M0 4v-16M14 4v-8" stroke="#e0fbff" stroke-opacity=".6"/><circle cy="-20" r="2.4" fill="#4fd1ff" class="blink"/>' +
        '<path d="M22 2l18-26" stroke="#c7d2fe" stroke-width="1.6"/><circle cx="40" cy="-26" r="3" fill="#f6c453" class="pulse"/></g>', 'moon');
    },
    mars: function (u) {
      var s = sphere(u, 70, '#ff8a5b', '#ffc4a3');
      var surf = '<path d="M-90-20c20-10 40 0 60-6s30-14 50-4 30 10 60 2v14c-30 8-40 0-60-4s-30 8-50 8-40-6-60 2z" fill="#8f2d13" opacity=".55"/>' +
        '<path d="M-60 26c14-6 30 2 44-2s20 10 10 16-30 0-40 2-24-8-14-16z" fill="#a23a19" opacity=".6"/>' +
        '<path d="M20-50c10-4 24 0 26 8s-12 10-20 8-14-12-6-16z" fill="#b5451f" opacity=".6"/>' +
        '<path d="M-80 4c20 4 40-2 60 2s30 8 50 4 40-6 60-2" stroke="#5c1a0a" stroke-width="2.4" fill="none" opacity=".7"/>' +
        '<circle cx="50" cy="30" r="9" fill="#c4552a"/><circle cx="52" cy="32" r="7" fill="#d9683a"/>';
      return wrapSvg('<defs>' + s.defs + '<radialGradient id="red' + u + '" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ffb380"/><stop offset=".55" stop-color="#e2582c"/><stop offset="1" stop-color="#7a1f0c"/></radialGradient></defs>' +
        s.glow + '<circle r="70" fill="url(#red' + u + ')"/>' + strip(u, 180, surf, 'slow') +
        '<g clip-path="url(#clip' + u + ')"><ellipse cy="-70" rx="40" ry="12" fill="#fff4ec" opacity=".85"/></g>' + s.shade +
        // colony domes
        '<g transform="translate(18 -64)">' +
        '<path d="M-26 6a12 10 0 0 1 24 0z" fill="#ffe1c9" fill-opacity=".8" stroke="#fff" stroke-width="1"/>' +
        '<path d="M-2 6a16 14 0 0 1 32 0z" fill="#ffe1c9" fill-opacity=".85" stroke="#fff" stroke-width="1"/>' +
        '<circle cx="14" cy="-2" r="2" fill="#7cf7c3" class="blink"/><circle cx="-14" cy="0" r="1.6" fill="#4fd1ff" class="blink d2"/></g>', 'mars');
    },
    asteroids: function (u) {
      var rocks = [
        [0, 0, 1.0, 'M-30-6l12-22 26-4 18 14 4 24-18 20-28-2-16-14z'], [-62, -40, 0.5, 'M-20-4l8-14 18-2 12 10 2 14-14 12-18-2-10-8z'],
        [64, -34, 0.6, 'M-18-8l10-12 20 2 10 14-6 16-20 4-14-10z'], [-58, 48, 0.55, 'M-16-10l14-8 18 6 4 16-12 12-18-2-8-12z'],
        [60, 50, 0.42, 'M-14-6l10-12 16 4 6 14-10 10-16-2z'], [-8, -72, 0.3, 'M-12-4l8-10 14 2 4 12-10 8-12-2z']
      ];
      var body = rocks.map(function (r, i) {
        return '<g transform="translate(' + r[0] + ' ' + r[1] + ') scale(' + r[2] + ')"><g class="tumble t' + i + '">' +
          '<path d="' + r[3] + '" fill="url(#rk' + u + ')" stroke="#f6c453" stroke-opacity=".35" stroke-width="1.5"/>' +
          '<circle cx="-6" cy="-4" r="5" fill="#5a4a37" opacity=".7"/><circle cx="10" cy="8" r="3.5" fill="#5a4a37" opacity=".6"/></g></g>';
      }).join('');
      return wrapSvg('<defs><radialGradient id="glow' + u + '"><stop offset="20%" stop-color="#f6c453" stop-opacity=".3"/><stop offset="100%" stop-color="#f6c453" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="rk' + u + '" cx="30%" cy="25%" r="90%"><stop offset="0" stop-color="#d9c3a0"/><stop offset=".5" stop-color="#8a7356"/><stop offset="1" stop-color="#3b2f24"/></radialGradient></defs>' +
        '<circle r="105" fill="url(#glow' + u + ')"/>' +
        '<ellipse rx="100" ry="26" fill="none" stroke="#f6c453" stroke-opacity=".25" stroke-width="10" transform="rotate(-14)"/>' +
        '<ellipse rx="100" ry="26" fill="none" stroke="#f6c453" stroke-opacity=".6" stroke-width="1" stroke-dasharray="2 6" transform="rotate(-14)" class="dash-run"/>' +
        body +
        // private corridor beacon
        '<path d="M-96 30L96-18" stroke="#7cf7c3" stroke-width="1.4" stroke-dasharray="6 6" class="dash-run" opacity=".8"/>', 'asteroids');
    },
    nullroute: function (u) {
      return wrapSvg('<defs><radialGradient id="core' + u + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd1da"/><stop offset=".2" stop-color="#ff4d6d"/><stop offset=".55" stop-color="#7a0a25"/><stop offset="1" stop-color="#14040b"/></radialGradient>' +
        '<radialGradient id="glow' + u + '"><stop offset="30%" stop-color="#ff4d6d" stop-opacity=".5"/><stop offset="100%" stop-color="#ff4d6d" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="body' + u + '" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#3a2340"/><stop offset=".7" stop-color="#120a1c"/><stop offset="1" stop-color="#05020a"/></radialGradient></defs>' +
        '<circle r="108" fill="url(#glow' + u + ')" class="pulse"/>' +
        '<circle r="66" fill="url(#body' + u + ')" stroke="#ff4d6d" stroke-opacity=".6" stroke-width="1.5"/>' +
        '<g class="orbit-spin"><circle r="84" fill="none" stroke="#ff4d6d" stroke-width="2" stroke-dasharray="40 14 4 14" opacity=".8"/></g>' +
        '<g class="orbit-spin rev"><circle r="96" fill="none" stroke="#ff4d6d" stroke-width="1" stroke-dasharray="2 10" opacity=".7"/></g>' +
        '<path d="M-50-14H50M-58 12H58M-40 34H40M-36-38H36" stroke="#ff4d6d" stroke-opacity=".18" stroke-width="1"/>' +
        '<ellipse rx="34" ry="20" fill="#0a0208" stroke="#ff4d6d" stroke-width="2"/>' +
        '<circle r="16" fill="url(#core' + u + ')" class="eye"/><circle r="5" fill="#fff"/>' +
        '<rect x="22" y="-46" width="30" height="4" fill="#ff4d6d" class="glitch"/><rect x="-60" y="30" width="22" height="3" fill="#4fd1ff" class="glitch d2"/>', 'nullroute');
    },
    beacon: function (u) {
      return wrapSvg('<defs><radialGradient id="glow' + u + '"><stop offset="20%" stop-color="#b794f6" stop-opacity=".45"/><stop offset="100%" stop-color="#b794f6" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="mast' + u + '" x1="0" x2="1"><stop offset="0" stop-color="#e9e3ff"/><stop offset="1" stop-color="#5b4a99"/></linearGradient></defs>' +
        '<circle r="100" fill="url(#glow' + u + ')"/>' +
        '<circle r="30" fill="none" stroke="#b794f6" stroke-width="2" class="ping"/><circle r="30" fill="none" stroke="#b794f6" stroke-width="2" class="ping d2"/>' +
        '<path d="M-26 60L0-40 26 60" fill="none" stroke="url(#mast' + u + ')" stroke-width="5"/>' +
        '<path d="M-18 30H18M-12 6H12M-7-16H7" stroke="#cbbcff" stroke-width="2.5"/>' +
        '<path d="M-40-46a48 48 0 0 1 80 0" fill="none" stroke="#e9e3ff" stroke-width="5"/>' +
        '<circle cy="-44" r="7" fill="#fff" class="pulse"/>', 'beacon');
    }
  };

  // Cadet ship (points right). The tiered ship lives in js/ship.js; this delegates to it so every
  // place that draws "the ship" shows the player's current tier. The legacy drawing is the fallback.
  A.ship = function (attrs) {
    if (ONA.ship && ONA.store && ONA.store.state) return ONA.ship.svg({ loadout: ONA.ship.loadout(ONA.store), compact: true, attrs: attrs || '' });
    var u = uid();
    return '<svg class="art ship-art" viewBox="-70 -34 140 68" ' + (attrs || '') + ' aria-hidden="true">' +
      '<defs><linearGradient id="sh' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7ff"/><stop offset=".55" stop-color="#a9b6e6"/><stop offset="1" stop-color="#4a5590"/></linearGradient>' +
      '<linearGradient id="fl' + u + '" x1="1" x2="0"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#7cf7ff"/><stop offset="1" stop-color="#4fd1ff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="cp' + u + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bff4ff"/><stop offset="1" stop-color="#1b4f8f"/></linearGradient></defs>' +
      '<g class="flame"><path d="M-40-7L-68 0-40 7z" fill="url(#fl' + u + ')"/><path d="M-40-4L-56 0-40 4z" fill="#fff"/></g>' +
      '<path d="M-22-10L-40-30-28-30 2-10z" fill="#4fd1ff" opacity=".9"/><path d="M-22 10L-40 30-28 30 2 10z" fill="#4fd1ff" opacity=".9"/>' +
      '<path d="M-42-10H20C40-10 56-4 62 0 56 4 40 10 20 10H-42z" fill="url(#sh' + u + ')" stroke="#e8ecff" stroke-width="1"/>' +
      '<path d="M14-8C28-8 40-4 46 0H14z" fill="url(#cp' + u + ')"/>' +
      '<path d="M-36 2H6" stroke="#4fd1ff" stroke-width="2"/><circle cx="-14" cy="-3" r="2" fill="#f6c453" class="blink"/>' +
      '</svg>';
  };

  A.portrait = function (who) {
    var u = uid();
    if (who === 'null') {
      return '<svg class="art portrait null" viewBox="0 0 120 120" aria-hidden="true"><defs>' +
        '<radialGradient id="pe' + u + '"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#ff4d6d"/><stop offset=".7" stop-color="#5c0a1f"/><stop offset="1" stop-color="#0d0207"/></radialGradient>' +
        '<pattern id="scan' + u + '" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#ff4d6d" fill-opacity=".09"/></pattern></defs>' +
        '<rect width="120" height="120" fill="#0d0207"/>' +
        '<path d="M60 14L98 36V84L60 106 22 84V36z" fill="#1d0710" stroke="#ff4d6d" stroke-width="2"/>' +
        '<circle cx="60" cy="60" r="24" fill="url(#pe' + u + ')" class="eye"/><circle cx="60" cy="60" r="6" fill="#fff"/>' +
        '<path d="M36 60H22M98 60H84" stroke="#ff4d6d" stroke-width="2"/>' +
        '<rect width="120" height="120" fill="url(#scan' + u + ')"/>' +
        '<rect x="70" y="24" width="30" height="3" fill="#ff4d6d" class="glitch"/><rect x="14" y="92" width="24" height="3" fill="#4fd1ff" class="glitch d2"/></svg>';
    }
    return '<svg class="art portrait vega" viewBox="0 0 120 120" aria-hidden="true"><defs>' +
      '<linearGradient id="pb' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12204a"/><stop offset="1" stop-color="#060b20"/></linearGradient>' +
      '<linearGradient id="hm' + u + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f7ff"/><stop offset=".6" stop-color="#9aa8dc"/><stop offset="1" stop-color="#3c4682"/></linearGradient>' +
      '<linearGradient id="vz' + u + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ff0ff"/><stop offset=".45" stop-color="#1f6fd1"/><stop offset="1" stop-color="#081a44"/></linearGradient></defs>' +
      '<rect width="120" height="120" fill="url(#pb' + u + ')"/>' +
      '<circle cx="96" cy="22" r="1.2" fill="#fff"/><circle cx="18" cy="30" r="1" fill="#fff"/><circle cx="104" cy="70" r=".9" fill="#fff"/>' +
      '<path d="M20 120c4-24 20-34 40-34s36 10 40 34z" fill="#2a3570"/><path d="M44 92l16 10 16-10" fill="none" stroke="#f6c453" stroke-width="3"/>' +
      '<circle cx="60" cy="56" r="34" fill="url(#hm' + u + ')"/>' +
      '<path d="M32 54c0-16 12-24 28-24s28 8 28 24c0 12-10 18-28 18S32 66 32 54z" fill="url(#vz' + u + ')" stroke="#e8ecff" stroke-width="1.5"/>' +
      '<path d="M40 46c6-8 16-10 24-8" stroke="#fff" stroke-opacity=".75" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M90 40l10-14" stroke="#c7d2fe" stroke-width="2"/><circle cx="100" cy="25" r="3" fill="#4fd1ff" class="blink"/>' +
      '<rect x="50" y="84" width="20" height="5" rx="2" fill="#4fd1ff" opacity=".8"/></svg>';
  };

  // 24x24 line icons, drawn centered on 0,0.
  var ICONS = {
    server: '<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M7.5 6.5h.01M7.5 17.5h.01M11 6.5h5M11 17.5h5"/>',
    db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-13M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    cloud: '<path d="M7 19h10.5a4.5 4.5 0 0 0 .4-9A6.5 6.5 0 0 0 5.6 11.6 3.8 3.8 0 0 0 7 19z"/>',
    router: '<circle cx="12" cy="12" r="9"/><path d="M12 5v5M12 14v5M5 12h5M14 12h5M12 5l-2 2M12 5l2 2M12 19l-2-2M12 19l2-2"/>',
    nat: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
    gateway: '<path d="M3 21V10l9-7 9 7v11M9 21v-6h6v6"/>',
    firewall: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.6h18M9 4v5.3M15 4v5.3M6 9.3v5.3M12 9.3v5.3M18 9.3v5.3M9 14.6V20M15 14.6V20"/>',
    lb: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v9M11 7l-5 9.5M13 7l5 9.5"/>',
    dns: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
    endpoint: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2"/>',
    vpc: '<rect x="2.5" y="4" width="19" height="16" rx="3" stroke-dasharray="3 2"/><rect x="6" y="8" width="5" height="4" rx="1"/><rect x="13" y="8" width="5" height="4" rx="1"/><rect x="9.5" y="14" width="5" height="3" rx="1"/>',
    subnet: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke-dasharray="2 2"/>',
    onprem: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M11 21v-3h2v3"/>',
    dbx: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/>'
  };
  var KIND_COLOR = {
    server: '#4fd1ff', subnet: '#4fd1ff', vpc: '#4fd1ff', db: '#7cf7c3', user: '#c7d2fe', onprem: '#c7d2fe',
    cloud: '#a5b4fc', router: '#b794f6', nat: '#b794f6', gateway: '#b794f6', lb: '#b794f6',
    firewall: '#f6c453', endpoint: '#f6c453', dns: '#67e8f9', dbx: '#ff8a5b'
  };
  A.icon = function (kind) { return ICONS[kind] || ICONS.server; };
  A.kindColor = function (kind) { return KIND_COLOR[kind] || '#4fd1ff'; };

  A.starIcon = function (filled) {
    return '<svg class="star-ico ' + (filled ? 'on' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
  };
  A.shieldIcon = function (state) {
    return '<svg class="shield-ico ' + state + '" viewBox="0 0 24 28" aria-hidden="true"><path d="M12 1.5L22 5v8c0 6.5-4.3 11.2-10 13.5C6.3 24.2 2 19.5 2 13V5z"/><path class="crack" d="M12 5l-2 6 4 3-3 7"/></svg>';
  };
  A.lockIcon = function () {
    return '<svg class="lock-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  };
})(window.ONA);
