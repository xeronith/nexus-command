(() => {
  'use strict';

  // ============================================================
  //  NEXUS COMMAND — a tiny StarCraft-like RTS prototype
  // ============================================================

  const WORLD = { w: 2600, h: 1700 };
  const CENTER = { x: 1300, y: 850 };
  const PLAYER_BASE = { x: 330, y: 1320 };
  const ENEMY_BASE = { x: 2270, y: 380 };
  const PLAYER = 0;
  const ENEMY = 1;
  const TEAM_COLOR = ['#4fe3ff', '#ff5675'];
  const CRYSTAL_COLOR = '#ffcf6e';
  const CARRY = 5;
  const GATHER_TIME = 1.3;
  const MAX_QUEUE = 3;
  const TAU = Math.PI * 2;
  const MOVE_PAN_SPEED = 1050;

  const DEFS = {
    hq: {
      name: 'Command Nexus', radius: 48, hp: 1400, isBuilding: true,
      cost: 0, buildTime: 0,
      train: { worker: { cost: 50, time: 7 } },
    },
    barracks: {
      name: 'Barracks', radius: 36, hp: 700, isBuilding: true,
      cost: 150, buildTime: 8,
      train: { soldier: { cost: 60, time: 5 } },
    },
    worker: {
      name: 'Harvester', radius: 10, hp: 50, speed: 112, cost: 50, buildTime: 6,
      damage: 4, range: 15, cooldown: 1.1, isWorker: true,
    },
    soldier: {
      name: 'Trooper', radius: 11, hp: 85, speed: 104, cost: 60, buildTime: 5,
      damage: 11, range: 135, cooldown: 0.8,
    },
    crystal: {
      name: 'Mineral Field', radius: 24, hp: 1, amount: 900, isResource: true,
    },
  };

  const PLAYER_CRYSTALS = [
    [468, 1168], [548, 1218], [438, 1242], [582, 1112], [642, 1258], [506, 1078],
  ];
  const ENEMY_CRYSTALS = PLAYER_CRYSTALS.map(([x, y]) => [WORLD.w - x, WORLD.h - y]);
  const NEUTRAL_CRYSTALS = [
    [1248, 806], [1352, 782], [1222, 906], [1326, 936],
  ];

  // ------------------------------------------------------------
  //  DOM
  // ------------------------------------------------------------

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const minimap = document.getElementById('minimap');
  const mmCtx = minimap.getContext('2d');
  const overlay = document.getElementById('overlay');
  const toastsEl = document.getElementById('toasts');
  const statMinerals = document.getElementById('statMinerals');
  const statArmy = document.getElementById('statArmy');
  const statWorkers = document.getElementById('statWorkers');
  const statTime = document.getElementById('statTime');
  const infoTag = document.getElementById('infoTag');
  const infoContent = document.getElementById('infoContent');
  const cmdHint = document.getElementById('cmdHint');
  const commandGrid = document.getElementById('commandGrid');
  const btnHelp = document.getElementById('btnHelp');
  const btnPause = document.getElementById('btnPause');
  const mmSector = document.getElementById('mmSector');

  // ------------------------------------------------------------
  //  UTILITIES
  // ------------------------------------------------------------

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  function hexA(hex, alpha) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  const glowCache = new Map();
  function glowSprite(color) {
    if (glowCache.has(color)) return glowCache.get(color);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, hexA(color, 0.85));
    grd.addColorStop(0.32, hexA(color, 0.28));
    grd.addColorStop(1, hexA(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    glowCache.set(color, c);
    return c;
  }

  function hexPath(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = rot + (i * TAU) / 6;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function chamferPath(x, y, w, h, cut) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + cut, y - h / 2);
    ctx.lineTo(x + w / 2 - cut, y - h / 2);
    ctx.lineTo(x + w / 2, y - h / 2 + cut);
    ctx.lineTo(x + w / 2, y + h / 2 - cut);
    ctx.lineTo(x + w / 2 - cut, y + h / 2);
    ctx.lineTo(x - w / 2 + cut, y + h / 2);
    ctx.lineTo(x - w / 2, y + h / 2 - cut);
    ctx.lineTo(x - w / 2, y - h / 2 + cut);
    ctx.closePath();
  }

  // ------------------------------------------------------------
  //  GAME STATE
  // ------------------------------------------------------------

  let view = { w: window.innerWidth, h: window.innerHeight, dpr: 1 };
  let camera = { x: 0, y: 0 };
  let entities = [];
  let selection = new Set();
  let minerals = [0, 0];
  let gameTime = 0;
  let state = 'menu';
  let nextId = 1;
  let ai = null;
  let mode = null;
  let visualTime = 0;
  let bgCanvas = null;
  let lastActionSig = '';
  let hudClock = 0;
  let lastTime = performance.now();
  let mmView = { s: 1, ox: 0, oy: 0 };
  let helpReturn = 'running';
  let minimapDragging = false;
  let lastAlert = -999;

  let effects = { tracers: [], particles: [], pings: [], floaters: [] };
  let stats = [makeStats(), makeStats()];

  const keys = new Set();
  const groups = {};
  const mouse = {
    x: view.w / 2, y: view.h / 2,
    wx: 0, wy: 0,
    inside: false, down: false, panning: false,
    startX: 0, startY: 0, lastX: 0, lastY: 0,
    drag: false,
  };
  let dragRect = null;

  function makeStats() {
    return { mined: 0, trained: 0, kills: 0, losses: 0 };
  }

  // ------------------------------------------------------------
  //  ENTITIES
  // ------------------------------------------------------------

  function createEntity(kind, team, x, y, opts = {}) {
    const def = DEFS[kind];
    const e = {
      id: nextId++,
      kind, team, x, y,
      vx: 0, vy: 0,
      radius: def.radius,
      maxHp: def.hp,
      hp: def.hp,
      facing: -Math.PI / 2,
      dead: false,
      selected: false,
      hitFlash: 0,
      cooldown: 0,
      retarget: 0,
      target: null,
      order: { type: 'idle' },
      seed: Math.random() * 1000,
      carry: 0,
      gatherTimer: 0,
    };

    if (def.isResource) {
      e.team = -1;
      e.amount = def.amount;
      e.maxHp = 1;
      e.hp = 1;
    }

    if (def.isBuilding) {
      e.complete = opts.complete !== false;
      e.buildProgress = e.complete ? 1 : 0;
      e.queue = [];
      e.rally = null;
      if (!e.complete) e.hp = def.hp * 0.12;
    }

    entities.push(e);
    return e;
  }

  function getHQ(team) {
    return entities.find((e) => !e.dead && e.team === team && e.kind === 'hq') || null;
  }

  function nearestCrystal(x, y, maxDist = Infinity) {
    let best = null;
    let bestD = maxDist;
    for (const e of entities) {
      if (e.dead || e.kind !== 'crystal' || e.amount <= 0) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function orderGather(worker, crystal) {
    worker.order = {
      type: 'gather',
      phase: worker.carry > 0 ? 'return' : 'toMineral',
      crystal: crystal || null,
      timer: 0,
    };
  }

  function orderMove(unit, x, y) {
    unit.target = null;
    unit.order = { type: 'move', x, y };
  }

  function orderAttack(unit, target, leash = null) {
    unit.target = target;
    unit.order = {
      type: 'attack',
      target,
      leash,
      leashX: unit.x,
      leashY: unit.y,
    };
  }

  function formationMove(units, x, y) {
    if (!units.length) return;
    const n = units.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const spacing = 27;
    units.forEach((u, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      orderMove(
        u,
        clamp(x + (col - (cols - 1) / 2) * spacing, 16, WORLD.w - 16),
        clamp(y + (row - (rows - 1) / 2) * spacing, 16, WORLD.h - 16)
      );
    });
  }

  function formationAttackMove(units, x, y) {
    if (!units.length) return;
    const n = units.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const spacing = 27;
    units.forEach((u, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      u.target = null;
      u.order = {
        type: 'attackMove',
        x: clamp(x + (col - (cols - 1) / 2) * spacing, 16, WORLD.w - 16),
        y: clamp(y + (row - (rows - 1) / 2) * spacing, 16, WORLD.h - 16),
      };
    });
  }

  function stopUnits(units) {
    for (const u of units) {
      u.order = { type: 'idle' };
      u.target = null;
      u.vx *= 0.2;
      u.vy *= 0.2;
    }
  }

  // ------------------------------------------------------------
  //  INIT / MAP
  // ------------------------------------------------------------

  function initGame() {
    entities = [];
    selection.clear();
    minerals = [300, 250];
    gameTime = 0;
    nextId = 1;
    stats = [makeStats(), makeStats()];
    effects = { tracers: [], particles: [], pings: [], floaters: [] };
    mode = null;
    dragRect = null;
    lastActionSig = '';
    helpReturn = 'running';
    lastAlert = -999;
    toastsEl.innerHTML = '';

    for (const k in groups) delete groups[k];

    ai = {
      timer: 1.8,
      wave: 4,
      wavesLaunched: 0,
      attackAt: 80,
      attacking: false,
      secondBarracks: false,
    };

    const pHQ = createEntity('hq', PLAYER, PLAYER_BASE.x, PLAYER_BASE.y);
    const eHQ = createEntity('hq', ENEMY, ENEMY_BASE.x, ENEMY_BASE.y);

    for (const [x, y] of PLAYER_CRYSTALS) createEntity('crystal', -1, x, y);
    for (const [x, y] of ENEMY_CRYSTALS) createEntity('crystal', -1, x, y);
    for (const [x, y] of NEUTRAL_CRYSTALS) createEntity('crystal', -1, x, y);

    const pWorkers = [];
    for (let i = 0; i < 4; i++) {
      pWorkers.push(createEntity('worker', PLAYER, 412 + i * 24, 1236 + (i % 2) * 26));
    }
    const eWorkers = [];
    for (let i = 0; i < 4; i++) {
      eWorkers.push(createEntity('worker', ENEMY, 2188 - i * 24, 464 - (i % 2) * 26));
    }

    for (const w of pWorkers) {
      const c = nearestCrystal(w.x, w.y);
      if (c) orderGather(w, c);
      selection.add(w);
    }
    for (const w of eWorkers) {
      const c = nearestCrystal(w.x, w.y);
      if (c) orderGather(w, c);
    }

    const pRally = nearestCrystal(pHQ.x, pHQ.y);
    if (pRally) pHQ.rally = { x: pRally.x, y: pRally.y, crystal: pRally };
    const eRally = nearestCrystal(eHQ.x, eHQ.y);
    if (eRally) eHQ.rally = { x: eRally.x, y: eRally.y, crystal: eRally };

    canvas.classList.remove('targeting', 'placing');
    camera.x = PLAYER_BASE.x - view.w / 2;
    camera.y = PLAYER_BASE.y - view.h / 2;
    clampCamera();
    updateHud(true);
  }

  // ------------------------------------------------------------
  //  UPDATE — UNITS
  // ------------------------------------------------------------

  function updateUnit(u, dt) {
    if (u.dead) return;
    if (u.cooldown > 0) u.cooldown -= dt;
    if (u.hitFlash > 0) u.hitFlash -= dt;

    if (DEFS[u.kind].isWorker) updateWorker(u, dt);
    else updateCombat(u, dt);

    resolveStatics(u);
    u.x = clamp(u.x, 12, WORLD.w - 12);
    u.y = clamp(u.y, 12, WORLD.h - 12);
  }

  function updateWorker(w, dt) {
    const o = w.order;

    if (o.type === 'gather') {
      updateGather(w, dt);
      return;
    }
    if (o.type === 'build') {
      updateBuild(w, dt);
      return;
    }
    if (o.type === 'move') {
      if (moveToward(w, o.x, o.y, dt, 3)) w.order = { type: 'idle' };
      return;
    }
    if (o.type === 'attack' || o.type === 'attackMove') {
      updateCombat(w, dt);
      return;
    }

    // idle: deliver any cargo, otherwise auto-defend
    if (w.carry > 0) {
      w.order = { type: 'gather', phase: 'return', crystal: null, timer: 0 };
      return;
    }
    updateCombat(w, dt);
  }

  function updateCombat(u, dt) {
    const o = u.order;

    if (o.type === 'move') {
      if (moveToward(u, o.x, o.y, dt, 3)) u.order = { type: 'idle' };
      return;
    }

    if (o.type === 'attack') {
      const t = o.target;
      if (!t || t.dead) {
        u.order = { type: 'idle' };
        u.target = null;
        return;
      }
      if (o.leash != null && dist2(t.x, t.y, o.leashX, o.leashY) > o.leash) {
        u.order = { type: 'idle' };
        u.target = null;
        return;
      }
      engage(u, t, dt);
      return;
    }

    if (o.type === 'attackMove') {
      u.retarget = (u.retarget || 0) - dt;
      let t = u.target;
      if (!t || t.dead) {
        t = null;
        if (u.retarget <= 0) {
          u.retarget = 0.35;
          u.target = findEnemyNear(u, 250);
          t = u.target;
        }
      }
      if (t && !t.dead) {
        engage(u, t, dt);
      } else if (moveToward(u, o.x, o.y, dt, 7)) {
        u.order = { type: 'idle' };
      }
      return;
    }

    // idle
    u.vx *= Math.max(0, 1 - dt * 8);
    u.vy *= Math.max(0, 1 - dt * 8);
    u.retarget = (u.retarget || 0) - dt;
    if (u.retarget <= 0) {
      u.retarget = 0.4;
      const t = findEnemyNear(u, 175);
      if (t) orderAttack(u, t, 270);
    }
  }

  function updateGather(w, dt) {
    const o = w.order;
    const hq = getHQ(w.team);
    if (!hq) {
      w.order = { type: 'idle' };
      return;
    }

    if (w.carry >= CARRY) o.phase = 'return';

    if (o.phase === 'return') {
      const stop = hq.radius + w.radius + 6;
      if (moveToward(w, hq.x, hq.y, dt, stop)) {
        const amount = w.carry;
        minerals[w.team] += amount;
        stats[w.team].mined += amount;
        w.carry = 0;
        effects.floaters.push({
          x: hq.x + rand(-14, 14), y: hq.y - 48,
          text: `+${amount}`, color: CRYSTAL_COLOR,
          ttl: 1.0, max: 1.0,
        });
        o.phase = 'toMineral';
      }
      return;
    }

    if (!o.crystal || o.crystal.dead || o.crystal.amount <= 0) {
      o.crystal = nearestCrystal(w.x, w.y);
      if (!o.crystal) {
        w.order = { type: 'idle' };
        return;
      }
    }

    const c = o.crystal;

    if (o.phase === 'mining') {
      w.facing = Math.atan2(c.y - w.y, c.x - w.x);
      w.vx *= Math.max(0, 1 - dt * 10);
      w.vy *= Math.max(0, 1 - dt * 10);
      o.timer -= dt;
      if (o.timer <= 0) {
        const take = Math.min(CARRY, c.amount);
        c.amount -= take;
        w.carry = take;
        o.phase = 'return';
        for (let i = 0; i < 3; i++) {
          effects.particles.push({
            x: c.x + rand(-10, 10), y: c.y + rand(-8, 8),
            vx: rand(-22, 22), vy: rand(-35, -8),
            ttl: 0.5, max: 0.5, color: CRYSTAL_COLOR, size: rand(1, 2),
          });
        }
        if (c.amount <= 0) {
          c.dead = true;
          burst(c.x, c.y, CRYSTAL_COLOR, 16, 1);
        }
      }
      return;
    }

    // toMineral
    const stop = c.radius + w.radius + 8;
    if (moveToward(w, c.x, c.y, dt, stop)) {
      o.phase = 'mining';
      o.timer = GATHER_TIME;
      w.vx = 0;
      w.vy = 0;
    }
  }

  function updateBuild(w, dt) {
    const site = w.order.site;
    if (!site || site.dead || site.complete) {
      w.order = { type: 'idle' };
      return;
    }
    const def = DEFS[site.kind];
    const stop = site.radius + w.radius + 10;
    if (dist(w, site) > stop) {
      moveToward(w, site.x, site.y, dt, stop);
      return;
    }

    w.facing = Math.atan2(site.y - w.y, site.x - w.x);
    w.vx *= Math.max(0, 1 - dt * 10);
    w.vy *= Math.max(0, 1 - dt * 10);

    site.buildProgress = Math.min(1, site.buildProgress + dt / def.buildTime);
    site.hp = Math.max(site.hp, site.maxHp * (0.12 + 0.88 * site.buildProgress));

    if (Math.random() < dt * 10) {
      effects.particles.push({
        x: site.x + rand(-site.radius, site.radius),
        y: site.y + rand(-site.radius, site.radius),
        vx: rand(-20, 20), vy: rand(-45, -10),
        ttl: 0.45, max: 0.45, color: CRYSTAL_COLOR, size: rand(1, 2),
      });
    }

    if (site.buildProgress >= 1) {
      site.complete = true;
      site.buildProgress = 1;
      site.hp = site.maxHp;
      w.order = { type: 'idle' };
      burst(site.x, site.y, TEAM_COLOR[site.team], 14, 1.2);
      if (site.team === PLAYER) {
        toast(`${def.name.toUpperCase()} ONLINE`, 'good');
      } else {
        site.rally = {
          x: clamp(site.x - 80, 40, WORLD.w - 40),
          y: clamp(site.y + 80, 40, WORLD.h - 40),
        };
      }
    }
  }

  function resolveStatics(u) {
    for (const s of entities) {
      if (s === u || s.dead) continue;
      if (!DEFS[s.kind].isBuilding && s.kind !== 'crystal') continue;
      const dx = u.x - s.x;
      const dy = u.y - s.y;
      const min = u.radius + s.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2);
        u.x = s.x + (dx / d) * min;
        u.y = s.y + (dy / d) * min;
      } else if (d2 === 0) {
        u.x = s.x + min;
      }
    }
  }

  function moveToward(e, tx, ty, dt, stopDist = 2) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy);

    if (d <= stopDist) {
      const damp = Math.max(0, 1 - dt * 12);
      e.vx *= damp;
      e.vy *= damp;
      return true;
    }

    const speed = DEFS[e.kind].speed || 100;
    let dvx = (dx / d) * speed;
    let dvy = (dy / d) * speed;

    // soft separation
    for (const o of entities) {
      if (o === e || o.dead || DEFS[o.kind].isResource) continue;
      const ox = e.x - o.x;
      const oy = e.y - o.y;
      const min = e.radius + o.radius + 5;
      const od2 = ox * ox + oy * oy;
      if (od2 > 0 && od2 < min * min) {
        const od = Math.sqrt(od2);
        const push = (1 - od / min) * speed * 1.7;
        dvx += (ox / od) * push;
        dvy += (oy / od) * push;
      }
    }

    const mag = Math.hypot(dvx, dvy);
    if (mag > speed) {
      dvx = (dvx / mag) * speed;
      dvy = (dvy / mag) * speed;
    }

    const k = Math.min(1, dt * 9);
    e.vx += (dvx - e.vx) * k;
    e.vy += (dvy - e.vy) * k;
    e.x += e.vx * dt;
    e.y += e.vy * dt;

    if (Math.hypot(e.vx, e.vy) > 4) e.facing = Math.atan2(e.vy, e.vx);
    return false;
  }

  function findEnemyNear(u, radius) {
    let best = null;
    let bestD = radius;
    for (const o of entities) {
      if (o.dead || o.team === u.team || DEFS[o.kind].isResource) continue;
      const d =
        Math.hypot(o.x - u.x, o.y - u.y) - o.radius - u.radius;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  function engage(u, target, dt) {
    const def = DEFS[u.kind];
    const reach = def.range + target.radius + u.radius;
    const d = dist(u, target);

    if (d > reach) {
      moveToward(u, target.x, target.y, dt, reach * 0.85);
      return;
    }

    u.vx *= Math.max(0, 1 - dt * 12);
    u.vy *= Math.max(0, 1 - dt * 12);
    u.facing = Math.atan2(target.y - u.y, target.x - u.x);

    if (u.cooldown <= 0) {
      u.cooldown = def.cooldown;
      fire(u, target);
    }
  }

  function fire(attacker, target) {
    const def = DEFS[attacker.kind];
    const col = TEAM_COLOR[attacker.team];
    const ang = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    const sx = attacker.x + Math.cos(ang) * (attacker.radius + 3);
    const sy = attacker.y + Math.sin(ang) * (attacker.radius + 3);

    effects.tracers.push({
      x1: sx, y1: sy, x2: target.x, y2: target.y,
      ttl: 0.09, max: 0.09, color: col,
      width: attacker.kind === 'soldier' ? 2 : 1.4,
    });

    for (let i = 0; i < 2; i++) {
      effects.particles.push({
        x: sx, y: sy,
        vx: Math.cos(ang) * rand(30, 90) + rand(-30, 30),
        vy: Math.sin(ang) * rand(30, 90) + rand(-30, 30),
        ttl: 0.22, max: 0.22, color: '#ffffff', size: rand(1, 2.2),
      });
    }
    for (let i = 0; i < 3; i++) {
      effects.particles.push({
        x: target.x + rand(-4, 4), y: target.y + rand(-4, 4),
        vx: rand(-45, 45), vy: rand(-45, 45),
        ttl: 0.3, max: 0.3, color: col, size: rand(1, 2.4),
      });
    }

    damage(target, def.damage * rand(0.85, 1.15), attacker);
  }

  function damage(target, amount, attacker) {
    if (target.dead || DEFS[target.kind].isResource) return;
    target.hp -= amount;
    target.hitFlash = 0.12;
    if (
      target.team === PLAYER && target.kind !== 'crystal' &&
      gameTime - lastAlert > 10
    ) {
      lastAlert = gameTime;
      toast(
        DEFS[target.kind].isBuilding ? 'BASE UNDER ATTACK' : 'UNITS UNDER ATTACK',
        'warn'
      );
      effects.pings.push({
        x: target.x, y: target.y, color: TEAM_COLOR[PLAYER],
        ttl: 0.8, max: 0.8, size: 38,
      });
    }
    if (target.hp <= 0) kill(target, attacker);
  }

  function kill(e, attacker) {
    if (e.dead) return;
    e.dead = true;

    const isBuilding = DEFS[e.kind].isBuilding;
    const col = TEAM_COLOR[e.team] || CRYSTAL_COLOR;
    if (e.kind === 'crystal') {
      burst(e.x, e.y, CRYSTAL_COLOR, 12, 0.8);
      return;
    }

    burst(e.x, e.y, col, isBuilding ? 34 : 9, isBuilding ? 2.3 : 1);
    if (isBuilding) {
      effects.pings.push({ x: e.x, y: e.y, color: col, ttl: 0.8, max: 0.8, size: 90 });
    }

    if (attacker && attacker.team != null) stats[attacker.team].kills++;
    stats[e.team].losses++;
    if (selection.has(e)) selection.delete(e);
    lastActionSig = '';
  }

  function burst(x, y, color, count, scale) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = rand(20, 130) * scale;
      effects.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        ttl: rand(0.35, 0.9) * Math.min(1.8, scale),
        max: 0.9,
        color: Math.random() < 0.2 ? '#ffffff' : color,
        size: rand(1, 3.2) * Math.min(2, scale),
      });
    }
    effects.pings.push({ x, y, color, ttl: 0.5, max: 0.5, size: 44 * scale });
  }

  // ------------------------------------------------------------
  //  UPDATE — BUILDINGS / PRODUCTION
  // ------------------------------------------------------------

  function updateBuilding(b, dt) {
    if (b.hitFlash > 0) b.hitFlash -= dt;
    if (!b.complete) return;
    if (!b.queue.length) return;
    const item = b.queue[0];
    item.progress += dt;
    if (item.progress >= item.time) {
      b.queue.shift();
      spawnTrained(b, item.kind);
    }
  }

  function queueUnit(b, kind) {
    if (!b || b.dead || !b.complete) return false;
    const train = DEFS[b.kind].train;
    if (!train || !train[kind]) return false;
    if (b.queue.length >= MAX_QUEUE) return false;
    const info = train[kind];
    if (minerals[b.team] < info.cost) return false;
    minerals[b.team] -= info.cost;
    b.queue.push({ kind, time: info.time, progress: 0 });
    if (b.team === PLAYER) lastActionSig = '';
    return true;
  }

  function spawnTrained(b, kind) {
    const pos = findSpawnSpot(b, kind);
    const u = createEntity(kind, b.team, pos.x, pos.y);
    stats[b.team].trained++;

    if (b.rally) {
      if (kind === 'worker' && b.rally.crystal && !b.rally.crystal.dead) {
        orderGather(u, b.rally.crystal);
      } else {
        orderMove(u, b.rally.x, b.rally.y);
      }
    }

    effects.pings.push({
      x: pos.x, y: pos.y, color: TEAM_COLOR[b.team],
      ttl: 0.4, max: 0.4, size: 26,
    });
    if (b.team === PLAYER) lastActionSig = '';
  }

  function findSpawnSpot(b, kind) {
    const r = DEFS[kind].radius;
    const baseAng = Math.atan2(CENTER.y - b.y, CENTER.x - b.x);
    for (let i = 0; i < 16; i++) {
      const off = Math.ceil(i / 2) * (TAU / 16) * (i % 2 === 0 ? 1 : -1);
      const a = baseAng + off;
      const x = b.x + Math.cos(a) * (b.radius + r + 12);
      const y = b.y + Math.sin(a) * (b.radius + r + 12);
      if (spawnClear(x, y, r)) return { x, y };
    }
    return { x: b.x + b.radius + r + 14, y: b.y };
  }

  function spawnClear(x, y, r) {
    if (x < 20 || y < 20 || x > WORLD.w - 20 || y > WORLD.h - 20) return false;
    for (const e of entities) {
      if (e.dead) continue;
      if (!DEFS[e.kind].isBuilding && e.kind !== 'crystal') continue;
      if (dist2(x, y, e.x, e.y) < r + e.radius + 6) return false;
    }
    return true;
  }

  // ------------------------------------------------------------
  //  ENEMY AI
  // ------------------------------------------------------------

  function updateAI(dt) {
    if (!ai) return;
    ai.timer -= dt;
    if (ai.timer > 0) return;
    ai.timer = 0.45;

    const hq = getHQ(ENEMY);
    if (!hq) return;

    const my = entities.filter((e) => !e.dead && e.team === ENEMY);
    const workers = my.filter((e) => e.kind === 'worker');
    const barracks = my.filter((e) => e.kind === 'barracks');
    const completeBarracks = barracks.filter((b) => b.complete);
    const sites = barracks.filter((b) => !b.complete);
    const soldiers = my.filter((e) => e.kind === 'soldier');

    // idle harvesters go back to work
    for (const w of workers) {
      if (w.order.type !== 'idle') continue;
      if (w.carry > 0) {
        w.order = { type: 'gather', phase: 'return', crystal: null, timer: 0 };
      } else {
        const c = nearestCrystal(w.x, w.y);
        if (c) orderGather(w, c);
      }
    }

    // finish incomplete construction
    if (sites.length) {
      const site = sites[0];
      const hasBuilder = workers.some(
        (w) => w.order.type === 'build' && w.order.site === site
      );
      if (!hasBuilder && workers.length) {
        const w = workers.slice().sort((a, b) => dist(a, site) - dist(b, site))[0];
        w.order = { type: 'build', site };
      }
    }

    // first barracks
    if (barracks.length === 0 && minerals[ENEMY] >= DEFS.barracks.cost) {
      const pos = findAIBuildSpot();
      const builder = workers.length ? workers[0] : null;
      if (pos && builder) {
        minerals[ENEMY] -= DEFS.barracks.cost;
        const site = createEntity('barracks', ENEMY, pos.x, pos.y, { complete: false });
        builder.order = { type: 'build', site };
        effects.pings.push({
          x: pos.x, y: pos.y, color: TEAM_COLOR[ENEMY],
          ttl: 0.5, max: 0.5, size: 40,
        });
      }
    }

    // second barracks later
    if (
      !ai.secondBarracks && gameTime > 80 && completeBarracks.length >= 1 &&
      barracks.length < 2 && minerals[ENEMY] >= 220
    ) {
      const pos = findAIBuildSpot();
      const builder = workers.length ? workers[0] : null;
      if (pos && builder) {
        minerals[ENEMY] -= DEFS.barracks.cost;
        const site = createEntity('barracks', ENEMY, pos.x, pos.y, { complete: false });
        builder.order = { type: 'build', site };
        ai.secondBarracks = true;
      }
    }

    // economy
    const workerQueued = hq.queue.filter((q) => q.kind === 'worker').length;
    if (
      workers.length + workerQueued < 8 &&
      hq.queue.length < 3 &&
      minerals[ENEMY] >= 50 &&
      !(barracks.length === 0 && minerals[ENEMY] < 200)
    ) {
      queueUnit(hq, 'worker');
    }

    // army
    const queuedSoldiers = completeBarracks.reduce(
      (n, b) => n + b.queue.filter((q) => q.kind === 'soldier').length,
      0
    );
    const armySize = soldiers.length + queuedSoldiers;
    for (const b of completeBarracks) {
      if (
        b.queue.length < 2 && minerals[ENEMY] >= 60 &&
        (ai.attacking || armySize < ai.wave)
      ) {
        queueUnit(b, 'soldier');
      }
      if (!b.rally) {
        b.rally = {
          x: clamp(b.x - 70, 40, WORLD.w - 40),
          y: clamp(b.y + 70, 40, WORLD.h - 40),
        };
      }
    }

    // launch attack waves
    if (
      !ai.attacking && gameTime >= ai.attackAt &&
      soldiers.length >= ai.wave
    ) {
      ai.attacking = true;
      ai.wavesLaunched++;
      const target = getHQ(PLAYER) || { x: PLAYER_BASE.x, y: PLAYER_BASE.y };
      for (const s of soldiers) {
        s.target = null;
        s.order = { type: 'attackMove', x: target.x, y: target.y };
      }
      effects.pings.push({
        x: target.x, y: target.y, color: TEAM_COLOR[ENEMY],
        ttl: 0.9, max: 0.9, size: 90,
      });
      toast('HOSTILE WAVE INBOUND', 'warn');
    }

    if (ai.attacking) {
      const target = getHQ(PLAYER);
      if (target) {
        for (const s of soldiers) {
          if (s.order.type === 'idle') {
            s.order = { type: 'attackMove', x: target.x, y: target.y };
          }
        }
      }
      if (soldiers.length === 0) {
        ai.attacking = false;
        ai.wave += 2;
      }
    }

    // defend the base
    const threat = my.length
      ? entities.find(
          (e) =>
            !e.dead && e.team === PLAYER && !DEFS[e.kind].isBuilding &&
            dist2(e.x, e.y, hq.x, hq.y) < 430
        )
      : null;

    if (threat) {
      for (const s of soldiers) {
        if (s.order.type === 'idle') orderAttack(s, threat);
      }
      if (!ai.attacking) {
        for (const p of completeBarracks) {
          if (p.queue.length < 1 && minerals[ENEMY] >= 60) queueUnit(p, 'soldier');
        }
      }
    }
  }

  function findAIBuildSpot() {
    const hq = getHQ(ENEMY);
    if (!hq) return null;
    const baseAng = Math.atan2(CENTER.y - hq.y, CENTER.x - hq.x);
    const offsets = [];
    for (let ring = 1; ring <= 3; ring++) {
      const radius = 100 + ring * 52;
      for (let i = 0; i < 12; i++) {
        offsets.push(baseAng + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (TAU / 12));
      }
      for (const a of offsets) {
        const x = hq.x + Math.cos(a) * radius;
        const y = hq.y + Math.sin(a) * radius;
        if (canPlace('barracks', x, y)) return { x, y };
      }
      offsets.length = 0;
    }
    return null;
  }

  // ------------------------------------------------------------
  //  UPDATE — EFFECTS / MAIN SIM
  // ------------------------------------------------------------

  function separateUnits() {
    const units = entities.filter(
      (e) => !e.dead && e.kind !== 'crystal' && !DEFS[e.kind].isBuilding
    );
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const min = a.radius + b.radius + 2;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 0.001) {
          dx = rand(-1, 1);
          dy = rand(-1, 1);
          d = Math.hypot(dx, dy) || 1;
        }
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  function updateEffects(dt) {
    for (const t of effects.tracers) t.ttl -= dt;
    for (const p of effects.particles) {
      p.ttl -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    for (const p of effects.pings) p.ttl -= dt;
    for (const f of effects.floaters) {
      f.ttl -= dt;
      f.y -= 26 * dt;
    }
    effects.tracers = effects.tracers.filter((t) => t.ttl > 0);
    effects.particles = effects.particles.filter((p) => p.ttl > 0);
    effects.pings = effects.pings.filter((p) => p.ttl > 0);
    effects.floaters = effects.floaters.filter((f) => f.ttl > 0);
  }

  function simulate(dt) {
    gameTime += dt;

    for (const u of [...entities]) {
      if (!u.dead && !DEFS[u.kind].isBuilding && u.kind !== 'crystal') {
        updateUnit(u, dt);
      }
    }

    separateUnits();

    for (const b of [...entities]) {
      if (!b.dead && DEFS[b.kind].isBuilding) updateBuilding(b, dt);
    }

    updateAI(dt);
    updateEffects(dt);

    for (const e of [...selection]) {
      if (e.dead) selection.delete(e);
    }

    const prevCount = entities.length;
    entities = entities.filter((e) => !e.dead);
    if (entities.length !== prevCount) lastActionSig = '';

    checkEnd();
  }

  function checkEnd() {
    if (state !== 'running') return;
    const playerHQ = entities.some((e) => !e.dead && e.team === PLAYER && e.kind === 'hq');
    const enemyHQ = entities.some((e) => !e.dead && e.team === ENEMY && e.kind === 'hq');
    if (!playerHQ) endGame(false);
    else if (!enemyHQ) endGame(true);
  }

  function endGame(won) {
    state = won ? 'won' : 'lost';
    mode = null;
    dragRect = null;
    mouse.down = false;
    canvas.classList.remove('targeting', 'placing');
    showEnd(won);
  }

  // ------------------------------------------------------------
  //  RENDERING — BACKGROUND
  // ------------------------------------------------------------

  function buildBackground() {
    const c = document.createElement('canvas');
    c.width = WORLD.w;
    c.height = WORLD.h;
    const g = c.getContext('2d');

    const base = g.createLinearGradient(0, 0, WORLD.w, WORLD.h);
    base.addColorStop(0, '#050a12');
    base.addColorStop(0.45, '#07111a');
    base.addColorStop(1, '#040810');
    g.fillStyle = base;
    g.fillRect(0, 0, WORLD.w, WORLD.h);

    paintGlow(g, PLAYER_BASE.x, PLAYER_BASE.y, 560, '40, 170, 210', 0.1);
    paintGlow(g, ENEMY_BASE.x, ENEMY_BASE.y, 560, '255, 70, 110', 0.09);
    paintGlow(g, CENTER.x, CENTER.y, 680, '100, 80, 190', 0.07);
    paintGlow(g, 720, 420, 420, '70, 120, 210', 0.035);
    paintGlow(g, 1880, 1280, 420, '70, 120, 210', 0.03);

    // stars
    for (let i = 0; i < 520; i++) {
      const x = rand(0, WORLD.w);
      const y = rand(0, WORLD.h);
      const r = rand(0.4, 1.6);
      const a = rand(0.12, 0.6);
      const warm = Math.random() < 0.12;
      g.fillStyle = warm ? `rgba(255, 214, 150, ${a * 0.7})` : `rgba(180, 228, 255, ${a})`;
      g.fillRect(x, y, r, r);
    }

    // grid
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(70, 150, 180, 0.042)';
    g.beginPath();
    for (let x = 0; x <= WORLD.w; x += 100) {
      g.moveTo(x, 0);
      g.lineTo(x, WORLD.h);
    }
    for (let y = 0; y <= WORLD.h; y += 100) {
      g.moveTo(0, y);
      g.lineTo(WORLD.w, y);
    }
    g.stroke();

    g.strokeStyle = 'rgba(79, 227, 255, 0.07)';
    g.beginPath();
    for (let x = 0; x <= WORLD.w; x += 500) {
      g.moveTo(x, 0);
      g.lineTo(x, WORLD.h);
    }
    for (let y = 0; y <= WORLD.h; y += 500) {
      g.moveTo(0, y);
      g.lineTo(WORLD.w, y);
    }
    g.stroke();

    // terrain debris
    for (let i = 0; i < 90; i++) {
      const x = rand(30, WORLD.w - 30);
      const y = rand(30, WORLD.h - 30);
      if (dist2(x, y, PLAYER_BASE.x, PLAYER_BASE.y) < 200) continue;
      if (dist2(x, y, ENEMY_BASE.x, ENEMY_BASE.y) < 200) continue;
      const r = rand(3, 16);
      g.beginPath();
      const points = 5 + Math.floor(rand(0, 3));
      for (let p = 0; p < points; p++) {
        const a = (p / points) * TAU;
        const rr = r * rand(0.6, 1.15);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (p === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = `rgba(14, 24, 34, ${rand(0.45, 0.8)})`;
      g.fill();
      g.strokeStyle = 'rgba(110, 160, 185, 0.06)';
      g.stroke();
    }

    // faint craters
    for (let i = 0; i < 26; i++) {
      const x = rand(60, WORLD.w - 60);
      const y = rand(60, WORLD.h - 60);
      const r = rand(18, 55);
      g.strokeStyle = 'rgba(90, 150, 180, 0.045)';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.5, rand(0, TAU), 0, TAU);
      g.stroke();
    }

    drawPlatform(g, PLAYER_BASE, '#4fe3ff');
    drawPlatform(g, ENEMY_BASE, '#ff5675');
    drawCenterRelay(g);

    // map border
    g.strokeStyle = 'rgba(79, 227, 255, 0.15)';
    g.lineWidth = 1;
    g.strokeRect(18.5, 18.5, WORLD.w - 37, WORLD.h - 37);
    g.strokeStyle = 'rgba(79, 227, 255, 0.32)';
    g.lineWidth = 2;
    const L = 46;
    const corners = [
      [18, 18, 1, 1], [WORLD.w - 18, 18, -1, 1],
      [18, WORLD.h - 18, 1, -1], [WORLD.w - 18, WORLD.h - 18, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      g.beginPath();
      g.moveTo(x + sx * L, y);
      g.lineTo(x, y);
      g.lineTo(x, y + sy * L);
      g.stroke();
    }

    g.font = '10px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(120, 190, 210, 0.14)';
    g.fillText('ALPHA SITE // 07', PLAYER_BASE.x - 58, PLAYER_BASE.y + 138);
    g.fillText('OMEGA SITE // 13', ENEMY_BASE.x - 54, ENEMY_BASE.y + 138);
    g.fillStyle = 'rgba(150, 140, 220, 0.13)';
    g.fillText('RELAY 4C', CENTER.x - 24, CENTER.y + 118);

    bgCanvas = c;
  }

  function paintGlow(g, x, y, r, rgb, alpha) {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grd.addColorStop(0.5, `rgba(${rgb}, ${alpha * 0.45})`);
    grd.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  function drawPlatform(g, p, color) {
    g.save();
    g.translate(p.x, p.y);
    const floor = g.createRadialGradient(0, 0, 10, 0, 0, 100);
    floor.addColorStop(0, 'rgba(10, 22, 32, 0.7)');
    floor.addColorStop(1, 'rgba(6, 12, 20, 0)');
    g.fillStyle = floor;
    g.beginPath();
    g.arc(0, 0, 100, 0, TAU);
    g.fill();

    for (const r of [66, 88, 108]) {
      g.strokeStyle = hexA(color, 0.1);
      g.lineWidth = 1;
      g.setLineDash(r === 88 ? [9, 8] : [2, 9]);
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = hexA(color, 0.18);
    for (let i = 0; i < 4; i++) {
      const a = i * (TAU / 4) + Math.PI / 4;
      g.beginPath();
      g.moveTo(Math.cos(a) * 92, Math.sin(a) * 92);
      g.lineTo(Math.cos(a) * 112, Math.sin(a) * 112);
      g.stroke();
    }
    g.restore();
  }

  function drawCenterRelay(g) {
    g.save();
    g.translate(CENTER.x, CENTER.y);
    for (const r of [58, 92, 126]) {
      g.strokeStyle = 'rgba(150, 140, 220, 0.09)';
      g.setLineDash(r === 92 ? [4, 10] : [1, 8]);
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = 'rgba(150, 140, 220, 0.12)';
    g.beginPath();
    g.moveTo(-150, 0);
    g.lineTo(150, 0);
    g.moveTo(0, -150);
    g.lineTo(0, 150);
    g.stroke();
    g.restore();
  }

  // ------------------------------------------------------------
  //  RENDERING — WORLD
  // ------------------------------------------------------------

  function render() {
    const dpr = view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04070c';
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    ctx.drawImage(bgCanvas, 0, 0);

    // ground markers
    for (const e of entities) {
      if (e.dead) continue;
      if (e.selected && e.rally && DEFS[e.kind].isBuilding) drawRally(e);
    }
    drawPings();

    const list = entities
      .filter((e) => !e.dead)
      .sort((a, b) => (a.y + a.radius) - (b.y + b.radius));

    for (const e of list) drawShadow(e);
    for (const e of list) drawEntity(e);
    for (const e of list) drawHealthBar(e);

    drawEffects();
    drawGhost();

    ctx.restore();

    drawSelectionBox();
  }

  function drawShadow(e) {
    if (e.kind === 'crystal') return;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.radius * 0.55, e.radius * 1.2, e.radius * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawEntity(e) {
    drawSelectionRing(e);
    const col = e.hitFlash > 0 ? '#ffffff' : (TEAM_COLOR[e.team] || CRYSTAL_COLOR);

    if (e.kind === 'crystal') drawCrystal(e);
    else if (e.kind === 'hq') drawHQ(e, col);
    else if (e.kind === 'barracks') drawBarracks(e, col);
    else if (e.kind === 'worker') drawWorker(e, col);
    else if (e.kind === 'soldier') drawSoldier(e, col);
  }

  function drawSelectionRing(e) {
    if (!e.selected) return;
    const col = TEAM_COLOR[e.team] || CRYSTAL_COLOR;
    const r = e.radius + (DEFS[e.kind].isBuilding ? 10 : 7);
    ctx.save();
    ctx.strokeStyle = hexA(col, 0.85);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -visualTime * 22;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.radius * 0.5, r * 1.25, r * 0.62, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawCrystal(e) {
    const scale = 0.5 + 0.5 * (e.amount / DEFS.crystal.amount);

    ctx.save();
    ctx.globalAlpha = 0.3 + 0.1 * Math.sin(visualTime * 1.8 + e.seed);
    ctx.drawImage(glowSprite(CRYSTAL_COLOR), e.x - 62, e.y - 62, 124, 124);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(10, 18, 26, 0.9)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 6, 24, 12, 0, 0, TAU);
    ctx.fill();

    const grd = ctx.createLinearGradient(e.x - 20, e.y - 34, e.x + 20, e.y + 16);
    grd.addColorStop(0, '#fff6cf');
    grd.addColorStop(0.4, '#ffd57e');
    grd.addColorStop(1, '#8a5620');

    for (let i = 0; i < 3; i++) {
      const a = e.seed + i * 2.12 + Math.sin(visualTime * 0.6 + e.seed) * 0.04;
      const ox = Math.cos(a) * 9;
      const oy = Math.sin(a) * 5 + 2;
      const h = (14 + (i % 2) * 9) * scale + 6;
      const w = 4.6 + (i % 2) * 1.4;
      const x = e.x + ox;
      const y = e.y + oy;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + w, y - h * 0.12);
      ctx.lineTo(x, y + h * 0.34);
      ctx.lineTo(x - w, y - h * 0.12);
      ctx.closePath();
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 248, 218, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    ctx.fillStyle = hexA(CRYSTAL_COLOR, 0.65);
    for (let i = 0; i < 2; i++) {
      const tw = (visualTime * 0.7 + e.seed + i * 1.7) % 3;
      if (tw < 0.22) {
        ctx.fillRect(e.x + Math.sin(e.seed + i * 3) * 16, e.y - 18 + Math.cos(e.seed + i) * 9, 1.6, 1.6);
      }
    }
    ctx.restore();
  }

  function drawHQ(e, col) {
    const pulse = 0.5 + 0.5 * Math.sin(visualTime * 2.1 + e.seed);

    ctx.save();
    ctx.globalAlpha = 0.15 + pulse * 0.06;
    ctx.drawImage(glowSprite(col), e.x - 105, e.y - 105, 210, 210);
    ctx.restore();

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(visualTime * 0.12);
    ctx.strokeStyle = hexA(col, 0.3);
    ctx.lineWidth = 1.3;
    ctx.setLineDash([11, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, 55, 0, TAU);
    ctx.stroke();
    ctx.rotate(-visualTime * 0.33);
    ctx.strokeStyle = hexA(col, 0.5);
    ctx.setLineDash([2, 11]);
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, TAU);
    ctx.stroke();
    ctx.restore();

    hexPath(e.x, e.y, 43, Math.PI / 6);
    ctx.fillStyle = '#07131d';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.7;
    ctx.stroke();

    hexPath(e.x, e.y, 31, Math.PI / 6);
    ctx.fillStyle = '#0a1e28';
    ctx.fill();
    ctx.strokeStyle = hexA(col, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.translate(e.x, e.y);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * TAU) / 6;
      const x = Math.cos(a) * 37;
      const y = Math.sin(a) * 37;
      ctx.fillStyle = hexA(col, 0.55 + pulse * 0.2);
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = hexA(col, 0.25);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 31, Math.sin(a) * 31);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();

    const coreR = 10 + pulse * 2;
    const core = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, coreR * 2.4);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.25, col);
    core.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(e.x, e.y, coreR * 2.4, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = hexA(col, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(e.x - 18, e.y);
    ctx.lineTo(e.x + 18, e.y);
    ctx.moveTo(e.x, e.y - 18);
    ctx.lineTo(e.x, e.y + 18);
    ctx.stroke();
  }

  function drawBarracks(e, col) {
    if (!e.complete) {
      ctx.save();
      ctx.strokeStyle = hexA(col, 0.5);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 5]);
      chamferPath(e.x, e.y, 62, 46, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = hexA(col, 0.18);
      ctx.beginPath();
      ctx.moveTo(e.x - 30, e.y - 22);
      ctx.lineTo(e.x + 30, e.y + 22);
      ctx.moveTo(e.x + 30, e.y - 22);
      ctx.lineTo(e.x - 30, e.y + 22);
      ctx.stroke();
      ctx.restore();

      const p = e.buildProgress;
      const w = 62;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(e.x - w / 2, e.y + 34, w, 4);
      ctx.fillStyle = CRYSTAL_COLOR;
      ctx.fillRect(e.x - w / 2, e.y + 34, w * p, 4);
      ctx.font = '8px ui-monospace, Menlo, monospace';
      ctx.fillStyle = hexA(col, 0.85);
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.floor(p * 100)}%`, e.x, e.y + 49);
      ctx.textAlign = 'start';
      return;
    }

    // body
    chamferPath(e.x, e.y, 62, 46, 8);
    ctx.fillStyle = '#08151f';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // roof band
    ctx.save();
    chamferPath(e.x, e.y, 54, 24, 6);
    ctx.clip();
    ctx.fillStyle = hexA(col, 0.12);
    ctx.fillRect(e.x - 30, e.y - 12, 60, 24);
    ctx.restore();

    ctx.strokeStyle = hexA(col, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(e.x - 24, e.y - 14);
    ctx.lineTo(e.x + 24, e.y - 14);
    ctx.moveTo(e.x - 24, e.y + 14);
    ctx.lineTo(e.x + 24, e.y + 14);
    ctx.stroke();

    // vents
    ctx.strokeStyle = hexA(col, 0.55);
    ctx.lineWidth = 1.4;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(e.x - 15 + i * 8, e.y + 2);
      ctx.lineTo(e.x - 15 + i * 8, e.y + 19);
      ctx.stroke();
    }

    // team chevron
    ctx.fillStyle = hexA(col, 0.9);
    ctx.beginPath();
    ctx.moveTo(e.x + 15, e.y - 6);
    ctx.lineTo(e.x + 23, e.y);
    ctx.lineTo(e.x + 15, e.y + 6);
    ctx.closePath();
    ctx.fill();

    // radar
    ctx.save();
    ctx.translate(e.x + 16, e.y - 15);
    ctx.strokeStyle = hexA(col, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.stroke();
    ctx.rotate(visualTime * 1.4 + e.seed);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(7, 0);
    ctx.stroke();
    ctx.restore();

    // status light
    ctx.fillStyle = hexA(col, 0.75 + 0.25 * Math.sin(visualTime * 3 + e.seed));
    ctx.beginPath();
    ctx.arc(e.x - 18, e.y - 19, 2.2, 0, TAU);
    ctx.fill();
  }

  function drawWorker(e, col) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.facing);

    ctx.strokeStyle = hexA(col, 0.8);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-2, -6);
    ctx.lineTo(-10, -10);
    ctx.moveTo(-2, 6);
    ctx.lineTo(-10, 10);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 8.2, 0, TAU);
    ctx.fillStyle = '#0a1a24';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = hexA(col, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 9, -0.55, 0.55);
    ctx.stroke();

    ctx.fillStyle = hexA(col, 0.9);
    ctx.beginPath();
    ctx.arc(4, 0, 1.7, 0, TAU);
    ctx.fill();

    if (e.carry > 0) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(glowSprite(CRYSTAL_COLOR), -8, -8, 16, 16);
      ctx.fillStyle = CRYSTAL_COLOR;
      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawSoldier(e, col) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.facing);

    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-7, 7);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-7, -7);
    ctx.closePath();
    ctx.fillStyle = '#0a1923';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = '#dff7ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(15, 0);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, 2.4, 0, TAU);
    ctx.fill();

    ctx.fillStyle = hexA(col, 0.5);
    ctx.beginPath();
    ctx.arc(-5, 0, 2, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawHealthBar(e) {
    if (e.kind === 'crystal') return;
    const isBuilding = DEFS[e.kind].isBuilding;
    if (!e.selected && e.hp >= e.maxHp - 0.5 && e.complete !== false) return;

    const w = isBuilding ? Math.max(48, e.radius * 2.1) : Math.max(24, e.radius * 2.4);
    const h = isBuilding ? 4 : 3;
    const x = e.x - w / 2;
    const y = e.y - e.radius - (isBuilding ? 17 : 13);
    const pct = clamp(e.hp / e.maxHp, 0, 1);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.66)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = TEAM_COLOR[e.team] || CRYSTAL_COLOR;
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawRally(e) {
    const r = e.rally;
    if (!r) return;
    const tx = r.crystal && !r.crystal.dead ? r.crystal.x : r.x;
    const ty = r.crystal && !r.crystal.dead ? r.crystal.y : r.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(79, 227, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -visualTime * 16;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = hexA(CRYSTAL_COLOR, 0.75);
    ctx.beginPath();
    ctx.arc(tx, ty, 9, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawPings() {
    for (const p of effects.pings) {
      const t = clamp(p.ttl / p.max, 0, 1);
      const size = (p.size || 40) * (1.6 - t * 0.6);
      ctx.save();
      ctx.globalAlpha = t;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = t * 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.55, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEffects() {
    for (const t of effects.tracers) {
      const a = clamp(t.ttl / t.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of effects.particles) {
      const a = clamp(p.ttl / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const f of effects.floaters) {
      const a = clamp(f.ttl / f.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  function drawGhost() {
    if (!mode || mode.type !== 'place') return;
    const def = DEFS[mode.kind];
    const ok = canPlace(mode.kind, mouse.wx, mouse.wy) && minerals[PLAYER] >= def.cost;
    const col = ok ? '#6bffc4' : '#ff5675';

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(mouse.wx, mouse.wy, def.radius + 8, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -visualTime * 18;
    chamferPath(mouse.wx, mouse.wy, def.radius * 1.7, def.radius * 1.3, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = col;
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ok ? def.name.toUpperCase() : 'BLOCKED', mouse.wx, mouse.wy - def.radius - 14);
    ctx.textAlign = 'start';
    ctx.restore();
  }

  function drawSelectionBox() {
    if (!dragRect) return;
    const x = Math.min(dragRect.x1, dragRect.x2);
    const y = Math.min(dragRect.y1, dragRect.y2);
    const w = Math.abs(dragRect.x2 - dragRect.x1);
    const h = Math.abs(dragRect.y2 - dragRect.y1);
    ctx.save();
    ctx.fillStyle = 'rgba(79, 227, 255, 0.07)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(79, 227, 255, 0.65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  // ------------------------------------------------------------
  //  MINIMAP
  // ------------------------------------------------------------

  function drawMinimap() {
    const dpr = view.dpr;
    const w = minimap.clientWidth || 220;
    const h = minimap.clientHeight || 128;
    if (minimap.width !== Math.floor(w * dpr) || minimap.height !== Math.floor(h * dpr)) {
      minimap.width = Math.floor(w * dpr);
      minimap.height = Math.floor(h * dpr);
    }
    mmCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mmCtx.clearRect(0, 0, w, h);
    mmCtx.fillStyle = '#03070c';
    mmCtx.fillRect(0, 0, w, h);

    const s = Math.min(w / WORLD.w, h / WORLD.h);
    const ox = (w - WORLD.w * s) / 2;
    const oy = (h - WORLD.h * s) / 2;
    mmView = { s, ox, oy };

    if (bgCanvas) mmCtx.drawImage(bgCanvas, ox, oy, WORLD.w * s, WORLD.h * s);
    mmCtx.fillStyle = 'rgba(2, 7, 12, 0.38)';
    mmCtx.fillRect(ox, oy, WORLD.w * s, WORLD.h * s);

    for (const e of entities) {
      if (e.dead) continue;
      const x = ox + e.x * s;
      const y = oy + e.y * s;
      if (e.kind === 'crystal') {
        mmCtx.fillStyle = 'rgba(255, 207, 110, 0.65)';
        mmCtx.fillRect(x - 1, y - 1, 2, 2);
      } else if (DEFS[e.kind].isBuilding) {
        mmCtx.fillStyle = TEAM_COLOR[e.team];
        mmCtx.fillRect(x - 2.5, y - 2.5, 5, 5);
        if (e.kind === 'hq') {
          mmCtx.fillRect(x - 4.5, y - 4.5, 9, 9);
          mmCtx.fillStyle = 'rgba(0, 0, 0, 0.55)';
          mmCtx.fillRect(x - 2.5, y - 2.5, 5, 5);
        }
      }
    }

    for (const e of entities) {
      if (e.dead || DEFS[e.kind].isBuilding || e.kind === 'crystal') continue;
      mmCtx.fillStyle = TEAM_COLOR[e.team];
      mmCtx.fillRect(ox + e.x * s - 1, oy + e.y * s - 1, 2, 2);
    }

    // camera viewport
    const vx = ox + camera.x * s;
    const vy = oy + camera.y * s;
    const vw = Math.min(view.w, WORLD.w) * s;
    const vh = Math.min(view.h, WORLD.h) * s;
    mmCtx.fillStyle = 'rgba(79, 227, 255, 0.06)';
    mmCtx.fillRect(vx, vy, vw, vh);
    mmCtx.strokeStyle = 'rgba(150, 242, 255, 0.65)';
    mmCtx.lineWidth = 1;
    mmCtx.strokeRect(vx + 0.5, vy + 0.5, Math.max(2, vw - 1), Math.max(2, vh - 1));

    // frame
    mmCtx.strokeStyle = 'rgba(79, 227, 255, 0.15)';
    mmCtx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  function minimapJump(ev) {
    const rect = minimap.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const wx = (mx - mmView.ox) / mmView.s;
    const wy = (my - mmView.oy) / mmView.s;
    if (wx < 0 || wy < 0 || wx > WORLD.w || wy > WORLD.h) return;
    camera.x = wx - view.w / 2;
    camera.y = wy - view.h / 2;
    clampCamera();
  }

  // ------------------------------------------------------------
  //  CAMERA
  // ------------------------------------------------------------

  function clampCamera() {
    if (view.w >= WORLD.w) camera.x = (WORLD.w - view.w) / 2;
    else camera.x = clamp(camera.x, 0, WORLD.w - view.w);
    if (view.h >= WORLD.h) camera.y = (WORLD.h - view.h) / 2;
    else camera.y = clamp(camera.y, 0, WORLD.h - view.h);
  }

  function centerOnBase() {
    const hq = getHQ(PLAYER);
    const p = hq || PLAYER_BASE;
    camera.x = p.x - view.w / 2;
    camera.y = p.y - view.h / 2;
    clampCamera();
  }

  function updateCamera(dt) {
    if (state !== 'running') return;
    let dx = 0;
    let dy = 0;
    if (keys.has('ArrowLeft')) dx -= 1;
    if (keys.has('ArrowRight')) dx += 1;
    if (keys.has('ArrowUp')) dy -= 1;
    if (keys.has('ArrowDown')) dy += 1;

    const topBound = 60;
    const bottomBound = 176;
    if (
      mouse.inside && mouse.y > topBound && mouse.y < view.h - bottomBound
    ) {
      if (mouse.x <= 5) dx -= 1;
      if (mouse.x >= view.w - 5) dx += 1;
    }

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      camera.x += (dx / len) * MOVE_PAN_SPEED * dt;
      camera.y += (dy / len) * MOVE_PAN_SPEED * dt;
    }
    clampCamera();
  }

  // ------------------------------------------------------------
  //  COMMANDS / SELECTION
  // ------------------------------------------------------------

  function selectedEntities() {
    return [...selection].filter((e) => !e.dead);
  }

  function selectedOwnUnits() {
    return selectedEntities().filter((e) => e.team === PLAYER && !DEFS[e.kind].isBuilding);
  }

  function selectedOwnBuildings() {
    return selectedEntities().filter((e) => e.team === PLAYER && DEFS[e.kind].isBuilding);
  }

  function pickEntity(wx, wy, includeCrystal = false) {
    let best = null;
    let bestScore = Infinity;
    for (const e of entities) {
      if (e.dead) continue;
      if (!includeCrystal && e.kind === 'crystal') continue;
      const d = Math.hypot(wx - e.x, wy - e.y);
      if (d > e.radius + 7) continue;
      let score = d;
      if (DEFS[e.kind].isBuilding) score -= 32;
      if (e.kind === 'crystal') score -= 60;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  function clickSelect(shift) {
    const hit = pickEntity(mouse.wx, mouse.wy);
    if (!hit || hit.kind === 'crystal') {
      if (!shift) selection.clear();
      lastActionSig = '';
      return;
    }
    if (!shift) selection.clear();
    if (shift && selection.has(hit)) selection.delete(hit);
    else selection.add(hit);
    lastActionSig = '';
  }

  function boxSelect(rect, shift) {
    const x1 = Math.min(rect.x1, rect.x2);
    const x2 = Math.max(rect.x1, rect.x2);
    const y1 = Math.min(rect.y1, rect.y2);
    const y2 = Math.max(rect.y1, rect.y2);
    if (!shift) selection.clear();
    for (const e of entities) {
      if (e.dead || e.team !== PLAYER || DEFS[e.kind].isBuilding || e.kind === 'crystal') continue;
      const sx = e.x - camera.x;
      const sy = e.y - camera.y;
      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) selection.add(e);
    }
    lastActionSig = '';
  }

  function issueContextCommand(wx, wy) {
    const ownUnits = selectedOwnUnits();
    const ownBuildings = selectedOwnBuildings();
    const target = pickEntity(wx, wy, true);

    if (ownUnits.length) {
      if (target && target.team !== PLAYER && target.team !== -1) {
        for (const u of ownUnits) orderAttack(u, target);
        effects.pings.push({
          x: target.x, y: target.y, color: TEAM_COLOR[ENEMY],
          ttl: 0.55, max: 0.55, size: 34,
        });
        return;
      }

      if (target && target.kind === 'crystal') {
        const workers = ownUnits.filter((u) => u.kind === 'worker');
        const others = ownUnits.filter((u) => u.kind !== 'worker');
        for (const w of workers) orderGather(w, target);
        if (others.length) {
          formationMove(others, target.x, target.y + target.radius + 42);
        }
        effects.pings.push({
          x: target.x, y: target.y, color: CRYSTAL_COLOR,
          ttl: 0.55, max: 0.55, size: 34,
        });
        return;
      }

      if (target && target.team === PLAYER && target.kind === 'barracks' && !target.complete) {
        const worker = ownUnits.find((u) => u.kind === 'worker');
        if (worker) {
          worker.order = { type: 'build', site: target };
          effects.pings.push({
            x: target.x, y: target.y, color: TEAM_COLOR[PLAYER],
            ttl: 0.55, max: 0.55, size: 34,
          });
          return;
        }
      }

      if (target && target.team === PLAYER && target.kind === 'hq') {
        for (const u of ownUnits) {
          if (u.kind === 'worker' && u.carry > 0) {
            u.order = { type: 'gather', phase: 'return', crystal: null, timer: 0 };
          }
        }
        const movers = ownUnits.filter((u) => !(u.kind === 'worker' && u.carry > 0));
        if (movers.length) {
          formationMove(movers, target.x, target.y + target.radius + 34);
        }
        effects.pings.push({
          x: target.x, y: target.y, color: TEAM_COLOR[PLAYER],
          ttl: 0.55, max: 0.55, size: 34,
        });
        return;
      }

      formationMove(ownUnits, wx, wy);
      effects.pings.push({
        x: wx, y: wy, color: TEAM_COLOR[PLAYER],
        ttl: 0.5, max: 0.5, size: 28,
      });
      return;
    }

    if (ownBuildings.length) {
      for (const b of ownBuildings) {
        if (target && target.kind === 'crystal') {
          b.rally = { x: target.x, y: target.y, crystal: target };
        } else if (target && target.team !== PLAYER) {
          b.rally = { x: target.x, y: target.y, crystal: null };
        } else {
          b.rally = { x: wx, y: wy, crystal: null };
        }
      }
      effects.pings.push({
        x: wx, y: wy, color: TEAM_COLOR[PLAYER],
        ttl: 0.6, max: 0.6, size: 36,
      });
      lastActionSig = '';
    }
  }

  function startPlacement(kind) {
    if (state !== 'running') return;
    const workers = selectedOwnUnits().filter((u) => u.kind === 'worker');
    if (!workers.length) {
      toast('SELECT A HARVESTER FIRST', 'warn');
      return;
    }
    if (minerals[PLAYER] < DEFS[kind].cost) {
      toast('NOT ENOUGH MINERALS', 'warn');
      return;
    }
    mode = { type: 'place', kind };
    canvas.classList.add('placing');
    canvas.classList.remove('targeting');
  }

  function enterAttackMove() {
    if (state !== 'running') return;
    if (!selectedOwnUnits().length) return;
    mode = { type: 'attackMove' };
    canvas.classList.add('targeting');
    canvas.classList.remove('placing');
  }

  function exitMode() {
    mode = null;
    canvas.classList.remove('targeting', 'placing');
  }

  function canPlace(kind, x, y) {
    const r = DEFS[kind].radius;
    if (x < r + 20 || y < r + 20 || x > WORLD.w - r - 20 || y > WORLD.h - r - 20) return false;
    for (const e of entities) {
      if (e.dead) continue;
      if (e.kind !== 'crystal' && !DEFS[e.kind].isBuilding) continue;
      if (dist2(x, y, e.x, e.y) < r + e.radius + 14) return false;
    }
    return true;
  }

  function handleModeClick(wx, wy) {
    if (!mode) return;
    if (mode.type === 'attackMove') {
      const units = selectedOwnUnits();
      if (units.length) {
        formationAttackMove(units, wx, wy);
        effects.pings.push({
          x: wx, y: wy, color: TEAM_COLOR[ENEMY],
          ttl: 0.6, max: 0.6, size: 34,
        });
      }
      exitMode();
      return;
    }

    if (mode.type === 'place') {
      const kind = mode.kind;
      const cost = DEFS[kind].cost;
      if (minerals[PLAYER] < cost) {
        toast('NOT ENOUGH MINERALS', 'warn');
        exitMode();
        return;
      }
      if (!canPlace(kind, wx, wy)) {
        toast('CANNOT BUILD THERE', 'warn');
        return;
      }

      minerals[PLAYER] -= cost;
      const site = createEntity(kind, PLAYER, wx, wy, { complete: false });
      const worker = selectedOwnUnits()
        .filter((u) => u.kind === 'worker')
        .sort((a, b) => dist(a, site) - dist(b, site))[0];

      if (worker) worker.order = { type: 'build', site };
      effects.pings.push({
        x: wx, y: wy, color: TEAM_COLOR[PLAYER],
        ttl: 0.6, max: 0.6, size: 46,
      });
      toast(`${DEFS[kind].name.toUpperCase()} UNDER CONSTRUCTION`);
      exitMode();
    }
  }

  function handleAction(id) {
    if (state !== 'running') return;
    if (id.startsWith('train:')) {
      const kind = id.split(':')[1];
      const b = selectedOwnBuildings().find((e) => e.complete && DEFS[e.kind].train && DEFS[e.kind].train[kind]);
      if (!b) return;
      if (!queueUnit(b, kind)) {
        if (b.queue.length >= MAX_QUEUE) toast('PRODUCTION QUEUE FULL', 'warn');
        else toast('NOT ENOUGH MINERALS', 'warn');
      }
      lastActionSig = '';
      return;
    }
    if (id === 'build:barracks') startPlacement('barracks');
    else if (id === 'attackmove') enterAttackMove();
    else if (id === 'stop') {
      stopUnits(selectedOwnUnits());
      exitMode();
    }
  }

  function setGroup(n, add) {
    if (!add) groups[n] = selectedEntities().filter((e) => e.team === PLAYER);
    else {
      const g = groups[n] || [];
      for (const e of selectedEntities()) {
        if (e.team === PLAYER && !g.includes(e)) g.push(e);
      }
      groups[n] = g;
    }
    if (groups[n].length) toast(`CONTROL GROUP ${n} ASSIGNED`);
  }

  function recallGroup(n) {
    const g = (groups[n] || []).filter((e) => !e.dead);
    if (!g.length) return;
    selection.clear();
    for (const e of g) selection.add(e);
    lastActionSig = '';
    const b = g.find((e) => DEFS[e.kind].isBuilding);
    const p = b || g[0];
    if (p) {
      camera.x = p.x - view.w / 2;
      camera.y = p.y - view.h / 2;
      clampCamera();
    }
  }

  // ------------------------------------------------------------
  //  HUD
  // ------------------------------------------------------------

  const ICONS = {
    worker: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2.6 19.6 6.8v8.4L12 19.4 4.4 15.2V6.8z"/><circle cx="12" cy="11.5" r="2.8"/><path d="M8.4 18.2 5 20.4M15.6 18.2 19 20.4"/></svg>`,
    soldier: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2.8 20 10l-8 11.2L4 10z"/><path d="M12 2.8V21.2"/></svg>`,
    barracks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.2 20.2V8.4L12 3l8.8 5.4v11.8"/><path d="M7.2 20.2v-6.1h9.6v6.1"/><path d="M9.2 10.6h5.6"/></svg>`,
    hq: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2.2 21 7.4v9.2L12 21.8 3 16.6V7.4z"/><path d="M12 7.2 16 9.6v4.8L12 16.8 8 14.4V9.6z"/></svg>`,
    crystal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2 18.5 9 12 22 5.5 9z"/><path d="M5.5 9h13M12 2v20"/></svg>`,
    attack: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="7"/><path d="M12 1.8v5M12 17.2v5M1.8 12h5M17.2 12h5"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.8" y="5.8" width="12.4" height="12.4"/></svg>`,
  };

  function getActions() {
    if (state !== 'running') return [];
    const own = selectedEntities().filter((e) => e.team === PLAYER);
    if (!own.length) return [];

    const units = own.filter((e) => !DEFS[e.kind].isBuilding);
    const buildings = own.filter((e) => DEFS[e.kind].isBuilding);
    const actions = [];

    if (buildings.length === 1 && units.length === 0) {
      const b = buildings[0];
      if (b.complete && DEFS[b.kind].train) {
        for (const kind of Object.keys(DEFS[b.kind].train)) {
          const info = DEFS[b.kind].train[kind];
          const item = b.queue[0];
          actions.push({
            id: `train:${kind}`,
            label: DEFS[kind].name.toUpperCase(),
            hotkey: 'Q',
            icon: ICONS[kind] || ICONS.worker,
            cost: info.cost,
            disabled: minerals[PLAYER] < info.cost || b.queue.length >= MAX_QUEUE,
            progress: item ? item.progress / item.time : 0,
            note: b.queue.length ? `${b.queue.length}Q` : '',
          });
        }
      }
    }

    const workers = units.filter((u) => u.kind === 'worker');
    if (workers.length) {
      actions.push({
        id: 'build:barracks',
        label: 'BARRACKS',
        hotkey: 'B',
        icon: ICONS.barracks,
        cost: DEFS.barracks.cost,
        disabled: minerals[PLAYER] < DEFS.barracks.cost,
      });
    }

    if (units.length) {
      actions.push({
        id: 'attackmove',
        label: 'ATTACK MOVE',
        hotkey: 'A',
        icon: ICONS.attack,
        disabled: false,
      });
      actions.push({
        id: 'stop',
        label: 'STOP',
        hotkey: 'S',
        icon: ICONS.stop,
        disabled: false,
      });
    }

    return actions;
  }

  function renderCommandPanel(actions) {
    if (!actions.length) {
      commandGrid.innerHTML = `<div class="cmd-empty">NO ORDERS AVAILABLE</div>`;
      cmdHint.textContent = selection.size ? 'NO UNIT' : 'STANDBY';
      return;
    }
    commandGrid.innerHTML = actions
      .map(
        (a) => `
      <button class="cmd" data-action="${a.id}" tabindex="-1">
        <span class="key">${a.hotkey}</span>
        ${a.note ? `<span class="note">${a.note}</span>` : ''}
        ${a.icon}
        <span class="label">${a.label}</span>
        ${a.cost != null ? `<span class="cost">${a.cost}</span>` : ''}
        <span class="prog" style="width:${Math.round((a.progress || 0) * 100)}%"></span>
      </button>`
      )
      .join('');

    const sel = selectedEntities();
    if (sel.length === 1) cmdHint.textContent = DEFS[sel[0].kind].name.toUpperCase();
    else cmdHint.textContent = `${sel.length} SELECTED`;
  }

  function updateActionStates(actions) {
    for (const a of actions) {
      const btn = commandGrid.querySelector(`[data-action="${a.id}"]`);
      if (!btn) continue;
      btn.disabled = !!a.disabled;
      const prog = btn.querySelector('.prog');
      if (prog) prog.style.width = `${Math.round((a.progress || 0) * 100)}%`;
      const note = btn.querySelector('.note');
      if (note) note.textContent = a.note || '';
    }
  }

  function statusText(e) {
    if (e.kind === 'crystal') return 'MINERAL FIELD';
    if (DEFS[e.kind].isBuilding) {
      if (!e.complete) return `CONSTRUCTING ${Math.floor(e.buildProgress * 100)}%`;
      if (e.queue.length) {
        const q = e.queue[0];
        return `PRODUCING ${DEFS[q.kind].name.toUpperCase()} ${Math.floor((q.progress / q.time) * 100)}%`;
      }
      return 'ONLINE';
    }
    const o = e.order;
    if (o.type === 'gather') {
      if (o.phase === 'return') return 'RETURNING CARGO';
      if (o.phase === 'mining') return 'EXTRACTING';
      return 'SEEKING MINERALS';
    }
    if (o.type === 'build') return 'CONSTRUCTING';
    if (o.type === 'attack') return 'ENGAGED';
    if (o.type === 'attackMove') return 'ADVANCING';
    if (o.type === 'move') return 'MOVING';
    return 'IDLE';
  }

  function renderInfo() {
    const sel = selectedEntities();
    if (!sel.length) {
      infoTag.textContent = '—';
      infoContent.innerHTML = `<div class="empty-hint">
        <b>DRAG</b> to select units &nbsp;·&nbsp; <b>RIGHT-CLICK</b> to move, attack or harvest<br>
        <b>B</b> build barracks &nbsp;·&nbsp; <b>Q</b> train &nbsp;·&nbsp; <b>A</b> attack-move &nbsp;·&nbsp; <b>SPACE</b> jump to base
      </div>`;
      return;
    }

    if (sel.length === 1) {
      const e = sel[0];
      const def = DEFS[e.kind];
      const isFoe = e.team === ENEMY;
      const pct = clamp(e.hp / e.maxHp, 0, 1) * 100;
      const icon = ICONS[e.kind] || ICONS.worker;
      const teamClass = isFoe ? 'foe' : 'own';
      let extra = '';
      if (e.kind === 'worker') extra = ` · CARGO ${e.carry}/${CARRY}`;
      else if (DEFS[e.kind].isBuilding && e.complete && e.queue.length) {
        extra = ` · QUEUE ${e.queue.length}/${MAX_QUEUE}`;
      }
      infoTag.textContent = isFoe ? 'HOSTILE' : 'FRIENDLY';
      infoContent.innerHTML = `
        <div class="info-row">
          <div class="portrait ${teamClass}">${icon}</div>
          <div class="info-main">
            <div class="info-name">${def.name}</div>
            <div class="info-status">${statusText(e)}${extra}</div>
            <div class="hp-track"><i class="${isFoe ? 'foe' : ''}" style="width:${pct}%"></i></div>
            <div class="hp-nums"><span>${Math.max(0, Math.ceil(e.hp))} / ${e.maxHp}</span><span>${Math.round(pct)}%</span></div>
          </div>
        </div>`;
      return;
    }

    const counts = {};
    for (const e of sel) counts[e.kind] = (counts[e.kind] || 0) + 1;
    const totalHp = sel.reduce((s, e) => s + e.hp, 0);
    const totalMax = sel.reduce((s, e) => s + e.maxHp, 0);
    const pct = clamp(totalHp / totalMax, 0, 1) * 100;
    const summary = Object.keys(counts)
      .map((k) => `${counts[k]} ${DEFS[k].name.toUpperCase()}${counts[k] > 1 ? 'S' : ''}`)
      .join(' · ');
    const isFoe = sel.every((e) => e.team === ENEMY);
    infoTag.textContent = isFoe ? 'HOSTILE' : 'FRIENDLY';
    infoContent.innerHTML = `
      <div class="info-row">
        <div class="portrait ${isFoe ? 'foe' : 'own'}">${ICONS.soldier}</div>
        <div class="info-main">
          <div class="info-name">${sel.length} UNITS SELECTED</div>
          <div class="info-status">${summary}</div>
          <div class="hp-track"><i class="${isFoe ? 'foe' : ''}" style="width:${pct}%"></i></div>
          <div class="hp-nums"><span>${Math.ceil(totalHp)} / ${totalMax} INTEGRITY</span><span>${Math.round(pct)}%</span></div>
        </div>
      </div>`;
  }

  function updateHud(force = false) {
    statMinerals.textContent = String(Math.floor(minerals[PLAYER]));
    statArmy.textContent = String(
      entities.filter((e) => !e.dead && e.team === PLAYER && e.kind === 'soldier').length
    );
    statWorkers.textContent = String(
      entities.filter((e) => !e.dead && e.team === PLAYER && e.kind === 'worker').length
    );
    statTime.textContent = formatTime(gameTime);
    mmSector.textContent = `SECTOR ${String(Math.floor(camera.x / 400) + 1).padStart(2, '0')}·${String(Math.floor(camera.y / 400) + 1).padStart(2, '0')}`;

    renderInfo();

    const actions = getActions();
    const sig = actions.map((a) => a.id).join(',') + '|' + selectedEntities().map((e) => e.id).join(',');
    if (force || sig !== lastActionSig) {
      renderCommandPanel(actions);
      lastActionSig = sig;
    }
    updateActionStates(actions);
    if (actions.length) {
      const sel = selectedEntities();
      if (sel.length === 1) cmdHint.textContent = DEFS[sel[0].kind].name.toUpperCase();
      else cmdHint.textContent = `${sel.length} SELECTED`;
    }
  }

  function toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    toastsEl.appendChild(el);
    while (toastsEl.children.length > 4) toastsEl.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, 2100);
  }

  // ------------------------------------------------------------
  //  OVERLAYS
  // ------------------------------------------------------------

  function openOverlay(html) {
    overlay.innerHTML = html;
    overlay.classList.remove('hidden');
  }

  function closeOverlay() {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  function showMenu() {
    state = 'menu';
    openOverlay(`
      <div class="overlay-card">
        <div class="eyebrow">REAL-TIME STRATEGY · PROTOTYPE 01</div>
        <h1 class="title">NEXUS<span>COMMAND</span></h1>
        <p class="tagline">Hold the line. Harvest the field. Break the enemy Nexus before it breaks yours.</p>
        <div class="controls">
          <div><kbd>LMB</kbd> select / drag a box</div>
          <div><kbd>RMB</kbd> move · attack · harvest · set rally</div>
          <div><kbd>B</kbd> build barracks <span class="sub">(harvester)</span></div>
          <div><kbd>Q</kbd> train unit <span class="sub">(nexus / barracks)</span></div>
          <div><kbd>A</kbd> attack-move · <kbd>S</kbd> stop</div>
          <div><kbd>ARROWS</kbd> pan · <kbd>SPACE</kbd> jump to base</div>
          <div><kbd>CTRL</kbd>+<kbd>1–9</kbd> set group · <kbd>1–9</kbd> recall</div>
          <div><kbd>MINIMAP</kbd> click / drag to reposition</div>
        </div>
        <button class="primary" id="btnDeploy">DEPLOY</button>
        <div class="footnote">DESTROY THE ENEMY COMMAND NEXUS TO WIN</div>
      </div>
    `);
    document.getElementById('btnDeploy').addEventListener('click', () => {
      closeOverlay();
      state = 'running';
      lastTime = performance.now();
      toast('COMMAND LINK ESTABLISHED', 'good');
      setTimeout(() => {
        if (state === 'running') toast('HARVESTERS SELECTED · PRESS [B] TO BUILD A BARRACKS');
      }, 1200);
      setTimeout(() => {
        if (state === 'running') toast('SELECT YOUR NEXUS · PRESS [Q] TO TRAIN HARVESTERS');
      }, 5200);
    });
  }

  function showPause() {
    openOverlay(`
      <div class="overlay-card compact">
        <div class="eyebrow">SIMULATION HALTED</div>
        <h2 class="subtitle">PAUSED</h2>
        <div class="pause-actions">
          <button class="primary" id="btnResume">RESUME</button>
          <button class="ghost-btn" id="btnPauseHelp">CONTROLS</button>
          <button class="ghost-btn" id="btnRestart">RESTART</button>
        </div>
      </div>
    `);
    document.getElementById('btnResume').addEventListener('click', resumeGame);
    document.getElementById('btnPauseHelp').addEventListener('click', () => showHelp('paused'));
    document.getElementById('btnRestart').addEventListener('click', () => {
      initGame();
      closeOverlay();
      state = 'running';
      lastTime = performance.now();
      toast('COMMAND LINK REINITIALIZED', 'good');
    });
  }

  function showHelp(from) {
    helpReturn = from || 'running';
    state = 'help';
    mode = null;
    mouse.down = false;
    dragRect = null;
    canvas.classList.remove('targeting', 'placing');
    openOverlay(`
      <div class="overlay-card">
        <div class="eyebrow">FIELD MANUAL</div>
        <h2 class="subtitle" style="font-size:22px">CONTROLS</h2>
        <div class="controls">
          <div><kbd>LMB</kbd> select unit / building, drag for box</div>
          <div><kbd>RMB</kbd> move, attack, harvest, rally</div>
          <div><kbd>Q</kbd> train selected building's unit</div>
          <div><kbd>B</kbd> build barracks with harvester</div>
          <div><kbd>A</kbd> attack-move targeting mode</div>
          <div><kbd>S</kbd> stop selected units</div>
          <div><kbd>SPACE</kbd> center camera on your Nexus</div>
          <div><kbd>P</kbd> pause / resume</div>
          <div><kbd>ARROWS</kbd> or screen edge to pan</div>
          <div><kbd>MMB</kbd> drag to pan · minimap to jump</div>
        </div>
        <div class="end-msg">
          Harvesters gather minerals automatically. New harvesters follow a Nexus rally set to a mineral field.<br>
          Troopers auto-attack nearby enemies when idle. Attack-move advances while engaging everything on the way.
        </div>
        <button class="primary" id="btnHelpClose">${helpReturn === 'paused' ? 'BACK' : 'RESUME'}</button>
      </div>
    `);
    document.getElementById('btnHelpClose').addEventListener('click', closeHelp);
  }

  function closeHelp() {
    if (helpReturn === 'paused') {
      state = 'paused';
      showPause();
    } else {
      state = 'running';
      closeOverlay();
      lastTime = performance.now();
    }
  }

  function showEnd(won) {
    const t = formatTime(gameTime);
    const k = stats[PLAYER].kills;
    const losses = stats[PLAYER].losses;
    const mined = Math.floor(stats[PLAYER].mined);
    openOverlay(`
      <div class="overlay-card">
        <div class="eyebrow">${won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}</div>
        <h2 class="subtitle" style="color:${won ? '#7beeff' : '#ff5675'}">${won ? 'VICTORY' : 'DEFEAT'}</h2>
        <div class="end-msg">${won
          ? 'The enemy Command Nexus has been reduced to scrap. The sector is yours.'
          : 'Your Command Nexus has fallen. Enemy forces control the sector.'}</div>
        <div class="stats-grid">
          <div class="stat-cell"><span>MISSION TIME</span><b>${t}</b></div>
          <div class="stat-cell"><span>MINERALS MINED</span><b class="accent">${mined}</b></div>
          <div class="stat-cell"><span>HOSTILES DESTROYED</span><b>${k}</b></div>
          <div class="stat-cell"><span>UNITS LOST</span><b class="warn">${losses}</b></div>
          <div class="stat-cell"><span>UNITS TRAINED</span><b>${stats[PLAYER].trained}</b></div>
          <div class="stat-cell"><span>ENEMY WAVES</span><b>${ai ? ai.wavesLaunched : 0}</b></div>
        </div>
        <button class="primary" id="btnAgain">REDEPLOY</button>
      </div>
    `);
    document.getElementById('btnAgain').addEventListener('click', () => {
      initGame();
      closeOverlay();
      state = 'running';
      lastTime = performance.now();
      toast('NEW COMMAND LINK ESTABLISHED', 'good');
    });
  }

  function pauseGame() {
    if (state !== 'running') return;
    state = 'paused';
    mode = null;
    mouse.down = false;
    dragRect = null;
    canvas.classList.remove('targeting', 'placing');
    showPause();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    closeOverlay();
    state = 'running';
    lastTime = performance.now();
  }

  // ------------------------------------------------------------
  //  INPUT
  // ------------------------------------------------------------

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = w;
    view.h = h;
    canvas.width = Math.floor(w * view.dpr);
    canvas.height = Math.floor(h * view.dpr);
    clampCamera();
  }

  function updateMouseWorld() {
    mouse.wx = mouse.x + camera.x;
    mouse.wy = mouse.y + camera.y;
  }

  canvas.addEventListener('mousemove', (ev) => {
    mouse.x = ev.clientX;
    mouse.y = ev.clientY;
    mouse.inside = true;
    updateMouseWorld();

    if (mouse.panning) {
      camera.x -= ev.clientX - mouse.lastX;
      camera.y -= ev.clientY - mouse.lastY;
      mouse.lastX = ev.clientX;
      mouse.lastY = ev.clientY;
      clampCamera();
      updateMouseWorld();
    }

    if (mouse.down && state === 'running') {
      if (Math.hypot(ev.clientX - mouse.startX, ev.clientY - mouse.startY) > 5) {
        mouse.drag = true;
        dragRect = { x1: mouse.startX, y1: mouse.startY, x2: ev.clientX, y2: ev.clientY };
      }
    }
  });

  canvas.addEventListener('mouseenter', () => { mouse.inside = true; });
  canvas.addEventListener('mouseleave', () => { mouse.inside = false; });

  canvas.addEventListener('mousedown', (ev) => {
    if (state !== 'running') return;
    mouse.x = ev.clientX;
    mouse.y = ev.clientY;
    updateMouseWorld();

    if (ev.button === 1) {
      ev.preventDefault();
      mouse.panning = true;
      mouse.lastX = ev.clientX;
      mouse.lastY = ev.clientY;
      return;
    }

    if (ev.button === 0) {
      if (mode) {
        handleModeClick(mouse.wx, mouse.wy);
        return;
      }
      mouse.down = true;
      mouse.drag = false;
      mouse.startX = ev.clientX;
      mouse.startY = ev.clientY;
    }
  });

  window.addEventListener('mouseup', (ev) => {
    if (ev.button === 1) mouse.panning = false;
    if (ev.button !== 0) return;
    if (!mouse.down) return;
    mouse.down = false;

    if (mouse.drag && dragRect) {
      boxSelect(dragRect, ev.shiftKey);
      dragRect = null;
      mouse.drag = false;
      return;
    }
    dragRect = null;
    clickSelect(ev.shiftKey);
  });

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (state !== 'running') return;
    updateMouseWorld();
    if (mode) {
      exitMode();
      return;
    }
    issueContextCommand(mouse.wx, mouse.wy);
  });

  canvas.addEventListener('auxclick', (ev) => {
    if (ev.button === 1) ev.preventDefault();
  });

  minimap.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    minimapDragging = true;
    minimapJump(ev);
  });

  window.addEventListener('mousemove', (ev) => {
    if (!minimapDragging) return;
    minimapJump(ev);
  });

  window.addEventListener('mouseup', () => { minimapDragging = false; });

  commandGrid.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.cmd');
    if (!btn || btn.disabled) return;
    handleAction(btn.dataset.action);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });

  window.addEventListener('keydown', (ev) => {
    const code = ev.code;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
      ev.preventDefault();
    }

    if (ev.metaKey) return;

    if (code === 'Escape') {
      if (state === 'help') {
        closeHelp();
        return;
      }
      if (state === 'paused') {
        resumeGame();
        return;
      }
      if (state !== 'running') return;
      if (mode) exitMode();
      else selection.clear();
      lastActionSig = '';
      return;
    }

    if (code === 'KeyH') {
      if (state === 'running') showHelp('running');
      else if (state === 'paused') showHelp('paused');
      else if (state === 'help') closeHelp();
      return;
    }

    if (code === 'KeyP') {
      if (state === 'running') pauseGame();
      else if (state === 'paused') resumeGame();
      return;
    }

    if (state !== 'running') return;

    const digit = /^Digit([1-9])$/.exec(code);
    if (digit) {
      const n = digit[1];
      if (ev.ctrlKey) {
        ev.preventDefault();
        setGroup(n, ev.shiftKey);
      } else {
        recallGroup(n);
      }
      return;
    }

    if (ev.ctrlKey || ev.altKey) return;

    if (code === 'KeyQ') {
      const actions = getActions();
      const train = actions.find((a) => a.id.startsWith('train:'));
      if (train) handleAction(train.id);
      return;
    }
    if (code === 'KeyB') {
      startPlacement('barracks');
      return;
    }
    if (code === 'KeyA') {
      enterAttackMove();
      return;
    }
    if (code === 'KeyS') {
      handleAction('stop');
      return;
    }
    if (code === 'Space') {
      centerOnBase();
      return;
    }

    if (code.startsWith('Arrow')) {
      keys.add(code);
    }
  });

  window.addEventListener('keyup', (ev) => {
    keys.delete(ev.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    mouse.inside = false;
    mouse.panning = false;
    mouse.down = false;
    dragRect = null;
    minimapDragging = false;
  });

  btnPause.addEventListener('click', () => {
    if (state === 'running') pauseGame();
    else if (state === 'paused') resumeGame();
  });

  btnHelp.addEventListener('click', () => {
    if (state === 'running') showHelp('running');
    else if (state === 'paused') showHelp('paused');
    else if (state === 'help') closeHelp();
  });

  window.addEventListener('resize', resize);
  window.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // ------------------------------------------------------------
  //  MAIN LOOP
  // ------------------------------------------------------------

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    visualTime += dt;

    if (state === 'running') {
      simulate(dt);
      updateCamera(dt);
    }

    render();
    drawMinimap();

    hudClock -= dt;
    if (hudClock <= 0) {
      hudClock = 0.1;
      updateHud();
    }

    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------
  //  DEBUG HOOK — handy for balancing and automated smoke tests
  // ------------------------------------------------------------

  window.__NEXUS__ = {
    get state() { return state; },
    get gameTime() { return gameTime; },
    get minerals() { return minerals.slice(); },
    get entities() { return entities; },
    get selection() { return [...selection]; },
    get ai() { return ai; },
    get stats() { return stats; },
    get camera() { return { ...camera }; },
    step(seconds = 1, dt = 0.05) {
      if (state !== 'running') return;
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) {
        if (state !== 'running') break;
        simulate(dt);
      }
      updateHud(true);
    },
    addMinerals(n) {
      minerals[PLAYER] += n;
      updateHud(true);
    },
    select(kind, team = PLAYER) {
      selection.clear();
      for (const e of entities) {
        if (!e.dead && e.kind === kind && e.team === team) selection.add(e);
      }
      lastActionSig = '';
      updateHud(true);
    },
    selectAll(team = PLAYER) {
      selection.clear();
      for (const e of entities) {
        if (!e.dead && e.team === team) selection.add(e);
      }
      lastActionSig = '';
      updateHud(true);
    },
    centerOn(x, y) {
      camera.x = x - view.w / 2;
      camera.y = y - view.h / 2;
      clampCamera();
    },
    spawn(kind, team, x, y) {
      if (!DEFS[kind]) return null;
      return createEntity(kind, team, x, y).id;
    },
  };

  // ------------------------------------------------------------
  //  BOOT
  // ------------------------------------------------------------

  resize();
  buildBackground();
  initGame();
  showMenu();
  requestAnimationFrame((t) => {
    lastTime = t;
    requestAnimationFrame(frame);
  });
})();
