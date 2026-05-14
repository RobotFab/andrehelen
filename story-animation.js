(function () {
  'use strict';

  const FONT = '15px helvetica, arial, sans-serif';
  const COLOR = '#385482';

  // Chain physics — stiff spring, hard velocity cap
  const CHAIN_K        = 0.1;  // stiff spring keeps words close to REST_LEN
  const REST_LEN       = 15;    // natural gap between consecutive words (px)
  const GRAVITY        = 0.02; // words are nearly weightless — chain barely drags balloon
  const DAMPING        = 0.88;
  const MAX_WORD_SPEED = 30;    // hard px/frame cap — prevents spring blowup

  // Balloon
  const UPFORCE          = 0.85;  // strong upward buoyancy
  const MAX_BALLOON_SINK = 1.6;   // hard cap on downward balloon velocity (px/frame)

  // Peel: a word peels only when its predecessor has moved this many px
  // beyond the natural layout distance between them. Each pair gets its own
  // threshold computed from the actual DOM positions, so same-line adjacent
  // words (large natural gap) resist cascading until truly pulled far apart.
  const PEEL_EXTRA = 24;

  let canvas, ctx;
  let chain = [];
  let balloon = { x: 0, y: 0, vx: 0, vy: 0, dragging: false, ox: 0, oy: 0 };
  let peeled = 0;
  let started = false;
  let draggedWord = null; // the free word node currently being dragged

  // ── Init ───────────────────────────────────────────────────────────────
  function init() {
    const story = document.querySelector('.story-section');
    if (!story || story.dataset.anim) return;
    story.dataset.anim = '1';

    story.querySelectorAll('p').forEach(p => {
      p.innerHTML = p.textContent.split(/(\s+)/).map(tok =>
        tok.trim() ? '<span class="sw">' + tok + '</span>' : tok
      ).join('');
    });

    requestAnimationFrame(() => requestAnimationFrame(() => build(story)));
  }

  // ── Build chain ────────────────────────────────────────────────────────
  function build(story) {
    const spans = [...story.querySelectorAll('.sw')];
    if (!spans.length) return;

    const items = spans.map(s => {
      const r = s.getBoundingClientRect();
      const px = r.left + window.scrollX;
      const py = r.top  + window.scrollY;
      return { s, text: s.textContent,
               x: px, y: py, lx: px, ly: py,
               w: r.width, vx: 0, vy: 0, free: false };
    });

    // Group into visual lines
    const lines = [];
    items.forEach(it => {
      const ln = lines.find(l => Math.abs(l[0].ly - it.ly) < 8);
      if (ln) ln.push(it); else lines.push([it]);
    });
    lines.sort((a, b) => a[0].ly - b[0].ly);
    lines.forEach(l => l.sort((a, b) => a.lx - b.lx));

    // Snake order: even lines L→R, odd lines R→L
    chain = [];
    lines.forEach((l, i) => chain.push(...(i % 2 ? [...l].reverse() : l)));

    // Pre-compute the layout distance from each node to its predecessor.
    // Peel fires only when the live distance exceeds this + PEEL_EXTRA,
    // so words with a wide natural gap (same line) resist cascading.
    chain.forEach((w, i) => {
      if (i === 0) {
        w.naturalDist = 30; // balloon hovers ~30 px above first word
      } else {
        const p = chain[i - 1];
        w.naturalDist = Math.hypot(
          (p.lx + p.w / 2) - (w.lx + w.w / 2),
          p.ly - w.ly
        );
      }
    });

    balloon.x = chain[0].lx + chain[0].w / 2;
    balloon.y = chain[0].ly - 30;

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:100;pointer-events:none;';
    document.body.appendChild(canvas);
    onResize();
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchstart', onTStart, { passive: false });
    document.addEventListener('touchmove', onTMove, { passive: false });
    document.addEventListener('touchend', onUp);

    requestAnimationFrame(tick);
  }

  function onResize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx = canvas.getContext('2d');
  }

  // ── Input ──────────────────────────────────────────────────────────────
  function nearBalloon(cx, cy) {
    return Math.hypot(cx - (balloon.x - window.scrollX),
                      cy - (balloon.y - window.scrollY)) < 42;
  }

  function beginDrag(cx, cy) {
    if (!nearBalloon(cx, cy)) return false;
    balloon.dragging = true;
    started = true;
    balloon.ox = cx - (balloon.x - window.scrollX);
    balloon.oy = cy - (balloon.y - window.scrollY);
    return true;
  }

  function moveDrag(cx, cy) {
    balloon.x = cx - balloon.ox + window.scrollX;
    balloon.y = cy - balloon.oy + window.scrollY;
  }

  function hitFreeWord(cx, cy) {
    const sx = window.scrollX, sy = window.scrollY;
    for (let i = 0; i < peeled; i++) {
      const w = chain[i];
      const wx = w.x - sx, wy = w.y - sy;
      if (cx >= wx && cx <= wx + w.w && cy >= wy && cy <= wy + 18) return w;
    }
    return null;
  }

  function beginWordDrag(cx, cy) {
    const w = hitFreeWord(cx, cy);
    if (!w) return false;
    draggedWord = w;
    w.ox = cx - (w.x - window.scrollX);
    w.oy = cy - (w.y - window.scrollY);
    started = true;
    return true;
  }

  function moveWordDrag(cx, cy) {
    draggedWord.x = cx - draggedWord.ox + window.scrollX;
    draggedWord.y = cy - draggedWord.oy + window.scrollY;
    draggedWord.vx = 0; draggedWord.vy = 0;
  }

  function onDown(e) {
    if (beginDrag(e.clientX, e.clientY))     { e.preventDefault(); return; }
    if (beginWordDrag(e.clientX, e.clientY)) { e.preventDefault(); }
  }
  function onMove(e) {
    const overBalloon = nearBalloon(e.clientX, e.clientY);
    const overWord    = !overBalloon && hitFreeWord(e.clientX, e.clientY) !== null;
    document.body.style.cursor =
      (balloon.dragging || draggedWord) ? 'grabbing' :
      overBalloon || overWord          ? 'grab'      : '';
    if (balloon.dragging) { moveDrag(e.clientX, e.clientY); return; }
    if (draggedWord)      { moveWordDrag(e.clientX, e.clientY); }
  }
  function onUp() { balloon.dragging = false; draggedWord = null; }
  function onTStart(e) {
    const t = e.touches[0];
    if (beginDrag(t.clientX, t.clientY))     { e.preventDefault(); return; }
    if (beginWordDrag(t.clientX, t.clientY)) { e.preventDefault(); }
  }
  function onTMove(e) {
    const t = e.touches[0];
    if (balloon.dragging) { moveDrag(t.clientX, t.clientY);     e.preventDefault(); return; }
    if (draggedWord)      { moveWordDrag(t.clientX, t.clientY); e.preventDefault(); }
  }

  // ── Spring impulse helper ──────────────────────────────────────────────
  // Returns the force pulling A toward B (caller applies +f to A, -f to B).
  // Optional k overrides CHAIN_K (used for slack chain links).
  function springF(ax, ay, bx, by, restLen, k = CHAIN_K) {
    const dx = bx - ax, dy = by - ay;
    const dist = Math.hypot(dx, dy) || 1;
    const mag  = (dist - restLen) * k / dist;
    return { fx: dx * mag, fy: dy * mag };
  }

  // ── Tick ───────────────────────────────────────────────────────────────
  function tick() {
    requestAnimationFrame(tick);

    // ── Balloon intent (upforce / pre-interaction bob) ─────────────────
    // Forces are accumulated here; damping + integration happen at the end.
    if (!balloon.dragging) {
      if (!started) {
        const t  = Date.now() * 0.001;
        const tx = chain[0].lx + chain[0].w / 2;
        const ty = chain[0].ly - 30 + Math.sin(t * 1.3) * 5;
        balloon.vx += (tx - balloon.x) * 0.05;
        balloon.vy += (ty - balloon.y) * 0.05;
      } else {
        balloon.vy -= UPFORCE;
      }
    }

    // ── Physics-based peel ─────────────────────────────────────────────
    if (started) {
      while (peeled < chain.length) {
        const w      = chain[peeled];
        const above  = peeled === 0 ? balloon : chain[peeled - 1];
        const aCX    = above.x + (peeled > 0 ? above.w / 2 : 0);
        const dist   = Math.hypot(aCX - (w.lx + w.w / 2), above.y - w.ly);
        if (dist > w.naturalDist + PEEL_EXTRA) {
          w.free = true; w.x = w.lx; w.y = w.ly; w.vx = 0; w.vy = -0.3;
          w.s.style.visibility = 'hidden';
          peeled++;
        } else { break; }
      }
    }

    // ── Bilateral spring forces ────────────────────────────────────────
    // Chain: balloon ⟷ chain[0] ⟷ … ⟷ chain[peeled-1] ⟷ anchor
    // Every pair exchanges equal-and-opposite impulses (Newton's 3rd).
    if (started) {
      if (peeled === 0 && chain.length > 0) {
        // Nothing peeled yet: resting chain[0] pulls the balloon.
        const a = chain[0];
        const f = springF(balloon.x, balloon.y, a.lx + a.w / 2, a.ly, a.naturalDist);
        if (!balloon.dragging) { balloon.vx += f.fx; balloon.vy += f.fy; }

      } else if (peeled > 0) {
        // balloon ⟷ chain[0]
        const w0 = chain[0];
        const f  = springF(balloon.x, balloon.y, w0.x + w0.w / 2, w0.y, REST_LEN);
        if (!balloon.dragging) { balloon.vx += f.fx; balloon.vy += f.fy; }
        w0.vx -= f.fx; w0.vy -= f.fy;

        // chain[i] ⟷ chain[i+1]
        for (let i = 0; i < peeled - 1; i++) {
          const a = chain[i], b = chain[i + 1];
          const f = springF(a.x + a.w / 2, a.y, b.x + b.w / 2, b.y, REST_LEN);
          a.vx += f.fx; a.vy += f.fy;
          b.vx -= f.fx; b.vy -= f.fy;
        }

        // chain[peeled-1] ⟷ anchor (fixed; only last word is pulled)
        if (peeled < chain.length) {
          const last = chain[peeled - 1];
          const anc  = chain[peeled];
          const f = springF(last.x + last.w / 2, last.y,
                            anc.lx  + anc.w  / 2, anc.ly, anc.naturalDist);
          last.vx += f.fx; last.vy += f.fy;
        }
      }
    }

    // ── Gravity + damping + velocity cap + integration (free words) ────
    // Dragged word's position is user-controlled — skip its integration.
    for (let i = 0; i < peeled; i++) {
      const w = chain[i];
      if (w === draggedWord) continue;
      if ((i + 1) % 5 === 0) {
        w.vy -= UPFORCE; // every 10th word floats like the balloon
      } else {
        w.vy += GRAVITY;
      }
      w.vx *= DAMPING; w.vy *= DAMPING;
      const spd = Math.hypot(w.vx, w.vy);
      if (spd > MAX_WORD_SPEED) { const s = MAX_WORD_SPEED / spd; w.vx *= s; w.vy *= s; }
      w.x += w.vx; w.y += w.vy;
    }

    // ── Balloon damping + integration ─────────────────────────────────
    if (!balloon.dragging) {
      balloon.vx *= DAMPING; balloon.vy *= DAMPING;
      // Hard cap on downward sink — the chain can never drag the balloon down fast
      if (balloon.vy > MAX_BALLOON_SINK) balloon.vy = MAX_BALLOON_SINK;
      balloon.x  += balloon.vx;
      balloon.y  += balloon.vy;
    }

    draw();
  }

  // ── Draw ───────────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = window.scrollX, sy = window.scrollY;

    ctx.font         = FONT;
    ctx.fillStyle    = COLOR;
    ctx.textBaseline = 'top';

    // Words hanging in the chain
    const free = chain.slice(0, peeled);
    free.forEach(w => ctx.fillText(w.text, w.x - sx, w.y - sy));

    // Balloon
    drawBalloon(balloon.x - sx, balloon.y - sy);
  }

  // ── Heart-shaped red balloon ───────────────────────────────────────────
  function drawBalloon(cx, cy) {
    const r = 23;
    ctx.save();

    // Heart — tip pointing down
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 1.15);
    ctx.bezierCurveTo(
      cx - r * 1.75, cy + r * 0.30,
      cx - r * 1.75, cy - r * 0.88,
      cx,            cy - r * 0.15
    );
    ctx.bezierCurveTo(
      cx + r * 1.75, cy - r * 0.88,
      cx + r * 1.75, cy + r * 0.30,
      cx,            cy + r * 1.15
    );
    ctx.fillStyle   = '#e63946';
    ctx.fill();
    ctx.strokeStyle = '#c1121f';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Gleam
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.47, cy - r * 0.22, r * 0.27, r * 0.16, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.fill();

    // Label
    ctx.fillStyle    = '#fff';
    ctx.font         = 'bold 10px helvetica, arial, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('drag me', cx, cy + r * 0.33);

    // Knot
    ctx.beginPath();
    ctx.arc(cx, cy + r * 1.15, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#c1121f';
    ctx.fill();

    // Short string from knot to chain
    ctx.strokeStyle = 'rgba(80,80,80,0.35)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 1.15 + 2.5);
    ctx.quadraticCurveTo(cx + 5, cy + r * 1.15 + 9, cx + 1, cy + r * 1.15 + 18);
    ctx.stroke();

    ctx.restore();
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
