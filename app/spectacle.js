// The Overlord's shows, mixed into World (see the end of world.js): its options menu, inspection
// patrols, its remarks, the holo-report, drones, the weather and the boss fight. The token stream
// is only bookkeeping here (which sessions are busy); overlay-fx.js draws all of it from fxSnapshot().
'use strict';

module.exports = (H) => {
  const { G, clamp, rand, pick, halfW, tall, spd } = H;
  const DRONE_SPEED = 720;
  const OUT = new Set(['hell', 'doom', 'ride', 'enter', 'birth', 'script', 'carried']);

  return {
    fxInit() {
      const now = Date.now();
      this.fx = {
        say: null, // { text, at, until }
        tags: [], // inspection read-outs: { id, at, until }
        drones: [],
        droneSeq: 0,
        weather: { kind: 'clear', at: 0, until: 0, auto: true, nextAuto: now + rand(25, 60) * 60e3, flash: 0, nextFlash: 0, bolt: 0 },
        boss: null,
        report: null,
        pulses: new Map(), // session id -> when its last hook event came in (the token stream)
        nextPatrol: now + rand(15, 30) * 60e3,
        patrols: true,
      };
    },

    /** Stop every show: the usage limit or a new buddy's build takes the Overlord over. */
    fxCancel() {
      const o = this.ov;
      o.patrol = null; o.menu = false; o.lookAt = null;
      this.fx.report = null;
      if (this.fx.boss) this.bossEnd(false, true);
    },

    pulse(id) { this.fx.pulses.set(id, Date.now()); },

    /** The Overlord is free for a show (not building, banishing or busy with another show). */
    ovFree() {
      const o = this.ov;
      return o.present && !this.doom && !this.fx.boss && ['fused', 'detached', 'returning'].includes(o.mode);
    },

    /** Leave the corner and float where everyone can see it. */
    ovLeaveCorner() {
      const o = this.ov, s = this.ovScale(), h = this.ovHome();
      if (o.mode === 'fused') { o.x = h.x; o.y = h.y - 14 * s; o.peek = null; }
      o.menu = false;
    },

    // ------------------------------------------------------------ the options menu (opened by clicking it)
    ovOpenMenu() {
      const o = this.ov;
      if (!o.present || this.doom || this.fx.boss || !['fused', 'detached', 'returning'].includes(o.mode)) return false;
      if (o.mode !== 'detached') this.ovDetach();
      o.menu = true;
      o.holdUntil = Date.now() + 8000;
      return true;
    },

    ovCloseMenu() {
      const o = this.ov;
      o.menu = false;
      if (o.mode === 'detached') this.ovReturn();
    },

    // ------------------------------------------------------------ remarks
    ovSay(text, ms) {
      const now = Date.now();
      this.fx.say = { text: String(text).toUpperCase(), at: now, until: now + (ms || clamp(1800 + text.length * 75, 2600, 6500)) };
    },

    // ------------------------------------------------------------ inspection patrol
    ovPatrol(ids) {
      const o = this.ov;
      if (!this.ovFree()) return false;
      const list = (ids || [...this.buddies.values()].filter((b) => b.mode === 'auto' && !b.isMini && !b.leaving && !b.hide).sort((a, c) => a.x - c.x).map((b) => b.id)).slice(0, 5);
      if (!list.length) return false;
      this.ovLeaveCorner();
      o.mode = 'patrol';
      o.patrol = { list, i: 0, phase: 'fly', at: Date.now() };
      this.patrolFly();
      return true;
    },

    patrolFly() {
      const o = this.ov, P = o.patrol;
      while (P && P.i < P.list.length) {
        const b = this.buddies.get(P.list[P.i]);
        if (b && b.mode === 'auto') {
          const s = this.ovScale(), d = this.displayAt(b.x, b.y - 2) || this.nearestDisplay(b.x, b.y);
          const ty = Math.max(d.bounds.y + 24 + 14 * s, b.y - tall(b) - 112 - 14 * s); // high enough for the stat tag to fit below it
          P.phase = 'fly'; P.at = Date.now(); P.id = b.id;
          this.ovTween({ x: b.x, y: ty }, clamp(Math.hypot(b.x - o.x, ty - o.y) * 1.1, 450, 1500), () => {
            if (o.mode !== 'patrol' || o.patrol !== P) return;
            P.phase = 'scan'; P.at = Date.now();
            const t = this.buddies.get(P.id);
            if (t && t.mode === 'auto' && !t.react && t.session.state !== 'working') { t.walkTarget = null; t.push('alert', 1500); }
            this.hooks.sound('scan', o.x, o.y);
          });
          return;
        }
        P.i++;
      }
      this.patrolEnd();
    },

    patrolEnd() {
      const o = this.ov;
      o.patrol = null; o.lookAt = null;
      if (o.mode === 'patrol') this.ovReturn();
    },

    patrolTick(now) {
      const o = this.ov, P = o.patrol;
      if (o.mode !== 'patrol' || !P) return;
      const b = this.buddies.get(P.id);
      if (b) o.lookAt = this.centre(b);
      if (P.phase === 'scan') {
        if (b && !o.tw) o.x += (b.x - o.x) * 0.08; // keep over it if it moves
        if (now - P.at > 1600) {
          if (b) {
            // One tag at a time: the previous one fades as the next buddy's comes up.
            for (const t of this.fx.tags) t.until = Math.min(t.until, now + 300);
            this.fx.tags = this.fx.tags.filter((t) => t.id !== b.id);
            this.fx.tags.push({ id: b.id, at: now, until: now + 6500 });
          }
          P.phase = 'pause'; P.at = now; P.i++;
        }
      } else if (P.phase === 'pause' && now - P.at > 450) this.patrolFly();
    },

    // ------------------------------------------------------------ the holo-report
    ovReport(data) {
      const o = this.ov;
      if (!this.ovFree()) return false;
      const d = this.displays.find((x) => x.primary) || this.displays[0];
      const s = this.ovScale();
      this.ovLeaveCorner();
      o.mode = 'report';
      const cx = d.workArea.x + d.workArea.width / 2, ey = d.workArea.y + 34 + 14 * s;
      const rows = clamp(data.rows.length, 1, 8), w = Math.min(600, d.workArea.width - 40), h = 150 + rows * 26;
      const now = Date.now();
      this.fx.report = { at: now + 700, until: now + 700 + 22000, data, rect: { x: cx - w / 2, y: ey + 14 * s + 24, w, h }, eye: { x: cx, y: ey } };
      this.ovTween({ x: cx, y: ey }, 700);
      return true;
    },

    reportClose() {
      if (!this.fx.report) return;
      this.fx.report = null;
      if (this.ov.mode === 'report') { this.ov.lookAt = null; this.ovReturn(); }
    },

    // ------------------------------------------------------------ drones
    ovPoint() {
      const o = this.ov;
      if (o.mode === 'fused') { const h = this.ovHome(); return { x: h.x, y: h.y + 10 }; }
      return { x: o.x, y: o.y + 10 * this.ovScale() };
    },

    droneLaunch(kind, b, extra = {}) {
      if (!this.ov.present || !b || this.fx.drones.length >= 12 || OUT.has(b.mode)) return null;
      const p = this.ovPoint();
      const d = { id: ++this.fx.droneSeq, kind, x: p.x, y: p.y, target: b, phase: 'out', at: Date.now(), flip: false, carry: kind === 'snack' ? 'cookie' : kind === 'files' ? 'parcel' : null, ...extra };
      this.fx.drones.push(d);
      this.hooks.sound('jump', p.x, p.y);
      return d;
    },

    /** A drone picks the buddy up with its tractor beam and drops it off at a spot (gathering across monitors). */
    droneCarry(b, point) { return this.droneLaunch('carry', b, { dest: point }); },

    dronesTick(now, dt) {
      const fx = this.fx;
      for (const d of [...fx.drones]) {
        const b = d.target && this.buddies.get(d.target.id) === d.target ? d.target : null;
        const fly = (tx, ty, speed = DRONE_SPEED) => {
          const dx = tx - d.x, dy = ty - d.y, m = Math.hypot(dx, dy);
          if (Math.abs(dx) > 2) d.flip = dx < 0;
          if (m <= speed * dt) { d.x = tx; d.y = ty; return true; }
          d.x += (dx / m) * speed * dt; d.y += (dy / m) * speed * dt;
          return false;
        };
        if (d.phase === 'out') {
          if (!b || b.leaving || OUT.has(b.mode) || b.mode === 'held') { d.phase = 'back'; continue; }
          const c = this.centre(b);
          if (fly(c.x, c.y - tall(b) * 0.5 - 56)) { d.phase = d.kind === 'carry' ? 'grab' : 'drop'; d.at = now; }
        } else if (d.phase === 'drop') {
          if (b && (b.mode === 'wall' || b.mode === 'ceil') && d.kind === 'snack') this.letGo(b, 'jump'); // it hops down to catch it
          if (now - d.at > 260) {
            if (b && d.kind === 'snack') {
              this.items.push({ id: ++this.itemSeq, kind: 'cookie', x: d.x, y: d.y + 10, vx: 0, vy: 0, owner: b, born: now });
              if (!b.task) b.task = { type: 'snack', until: now + 9000 };
              this.wake(b);
            }
            if (b && d.kind === 'files') { try { d.onArrive?.(b); } catch (err) { this.hooks.error?.(err, 'drone delivery'); } }
            d.carry = null; d.phase = 'back'; d.at = now;
          }
        } else if (d.phase === 'grab') {
          if (!b || OUT.has(b.mode) || b.mode === 'held' || now - d.at < 350) { if (!b || OUT.has(b.mode) || b.mode === 'held') d.phase = 'back'; continue; }
          if (b.mode === 'wall' || b.mode === 'ceil') this.uprightFrom(b);
          b.mode = 'carried'; b.task = null; b.walkTarget = null; b.action = null; b.react = null; b.meet = null; b.exit = null;
          b.queue = b.queue.filter((q) => q.then);
          d.phase = 'carry'; d.at = now;
          this.sound(b, 'chirp');
        } else if (d.phase === 'carry') {
          if (!b || b.mode !== 'carried') { d.phase = 'back'; continue; }
          const arrived = fly(d.dest.x, d.dest.y - 110, DRONE_SPEED * 0.8);
          b.x = d.x; b.y = d.y + 16 + tall(b); b.flip = d.flip; b.bubble = null;
          b.scale = this.scaleAt(b);
          b.setAnim('held');
          if (arrived) { this.drop(b, 'drop'); b.vy = 80; d.phase = 'back'; d.at = now; }
        } else if (d.phase === 'back') {
          const p = this.ovPoint();
          if (fly(p.x, p.y, DRONE_SPEED * 1.2)) fx.drones.splice(fx.drones.indexOf(d), 1);
        }
      }
    },

    // ------------------------------------------------------------ weather
    setWeather(kind, minutes = 8) {
      const W = this.fx.weather, now = Date.now();
      if (kind === 'clear') { if (W.kind !== 'clear') W.until = Math.min(W.until, now); return; }
      W.kind = kind; W.at = now; W.until = now + minutes * 60e3; W.nextFlash = now + rand(3000, 7000);
      this.hooks.weather?.(kind);
    },

    /** Raining (or storming) properly: buddies stay on the ground with an umbrella up. */
    isWet(now = Date.now()) {
      const W = this.fx.weather;
      return (W.kind === 'rain' || W.kind === 'storm') && this.weatherLevel(now) > 0.3;
    },

    weatherLevel(now = Date.now()) {
      const W = this.fx.weather;
      if (W.kind === 'clear') return 0;
      return clamp(Math.min((now - W.at) / 6000, (W.until + 8000 - now) / 8000), 0, 1);
    },

    weatherTick(now) {
      const W = this.fx.weather;
      if (W.kind !== 'clear' && now > W.until + 8000) { W.kind = 'clear'; W.nextAuto = now + rand(45, 120) * 60e3; }
      if (W.auto && W.kind === 'clear' && now > W.nextAuto) {
        W.nextAuto = now + rand(45, 120) * 60e3;
        if (!this.doom && this.buddies.size) {
          const m = new Date(now).getMonth(), winter = m === 11 || m <= 1, r = Math.random();
          this.setWeather(winter ? (r < 0.6 ? 'snow' : r < 0.85 ? 'rain' : 'storm') : (r < 0.55 ? 'rain' : r < 0.8 ? 'storm' : 'snow'), rand(3, 7));
        }
      }
      if (W.kind === 'storm' && now < W.until && now > W.nextFlash) {
        W.flash = now; W.bolt = Math.random(); W.nextFlash = now + rand(5000, 14000);
        const d = this.displays.find((x) => x.primary) || this.displays[0];
        if (d) this.hooks.sound('thunder', d.bounds.x + d.bounds.width / 2, d.bounds.y + 60);
        for (const b of this.buddies.values()) if (b.mode === 'auto' && !b.react && !b.task && b.session.state !== 'working' && Math.random() < 0.5) b.push('startled', 700);
      }
    },

    /** Snow: idle buddies lob snowballs at each other now and then. Returns true if it threw one. */
    maybeSnowball(b, now) {
      if (this.fx.weather.kind !== 'snow' || this.weatherLevel(now) < 0.5 || Math.random() > 0.3) return false;
      const o = this.nearby(b, 420, (x) => x.session.state !== 'working' && !x.sleeping);
      if (!o) return false;
      const dir = o.x > b.x ? 1 : -1, dx = Math.abs(o.x - b.x), T = clamp(dx / 520, 0.35, 0.9);
      const y0 = b.y - tall(b) * 0.7, ty = o.y - tall(o) * 0.5;
      this.items.push({ id: ++this.itemSeq, kind: 'snowball', x: b.x + dir * halfW(b), y: y0, vx: (dir * dx) / T, vy: (ty - y0 - 0.5 * G * T * T) / T, thrower: b, target: o, born: now, owner: b });
      b.flip = dir < 0;
      b.push('cheer', 500, { face: dir < 0 });
      return true;
    },

    // ------------------------------------------------------------ the boss fight
    bossStart() {
      const o = this.ov, now = Date.now();
      if (!o.present || this.doom || this.fx.boss || ['building', 'doom'].includes(o.mode)) return false;
      const team = [...this.buddies.values()].filter((b) => ['auto', 'wall', 'ceil', 'float'].includes(b.mode) && !b.isMini && !b.leaving && !b.hide
        && b.session.attention !== 'permission' && b.session.attention !== 'question').slice(0, 8);
      const d = this.displays.find((x) => x.primary) || this.displays[0];
      if (!team.length || !d) return false;
      const mid = d.workArea.x + d.workArea.width / 2;
      const floor = this.platforms.find((p) => !p.win && p.x1 <= mid && p.x2 >= mid && Math.abs(p.y - this.floorY(d)) < 3);
      if (!floor) return false;
      this.fxCancel();
      this.ovLeaveCorner();
      const cx = mid, cy = d.workArea.y + d.workArea.height * 0.3;
      o.mode = 'boss'; o.red = true;
      this.ovTween({ x: cx, y: cy }, 1200, null, 1.5);
      this.fx.boss = { phase: 'intro', at: now, hp: 100, max: 100, cx, cy, d, floor, team: team.map((b) => b.id), shots: [], laser: null, next: now + 4200, until: now + 3200 + 60e3, hitAt: 0, sparks: [], boom: 0 };
      team.forEach((b, i) => {
        if (b.mode !== 'auto') this.letGo(b, 'jump');
        b.task = { type: 'boss', slot: i, n: team.length, until: Infinity };
        b.meet = null; b.sleeping = false; b.idleSince = now; b.hide = null;
      });
      this.ovSay('YOU DARE CHALLENGE ME?', 3000);
      this.hooks.sound('doom', cx, cy);
      return true;
    },

    /** A buddy's part in the fight: line up under the Overlord, throw code at it, dodge its attacks. */
    bossTask(b, T, now) {
      const B = this.fx.boss;
      if (!B || b.session.attention === 'permission' || b.session.attention === 'question') { b.task = null; return false; }
      if (b.mode === 'wall' || b.mode === 'ceil' || b.mode === 'float') { this.letGo(b, 'jump'); return true; }
      if (b.mode !== 'auto') return true;
      b.bubble = null;
      const room = B.floor.x2 - B.floor.x1 - 4 * halfW(b), span = Math.min(room, 120 + T.n * 22 * b.scale);
      const sx = clamp(B.cx + (T.n === 1 ? 0 : -span / 2 + (span * T.slot) / (T.n - 1)), B.floor.x1 + halfW(b), B.floor.x2 - halfW(b));
      if (!b.plat || b.plat.key !== B.floor.key) {
        if (!T.leapt || now - T.leapt > 1600) { T.leapt = now; this.leapTo(b, sx, B.floor); }
        return true;
      }
      if (b.walkTarget !== null) { b.setAnim(b.walkAnim); return true; } // dodging or getting into place
      if (!T.placed && Math.abs(b.x - sx) > 4) { this.walkTo(b, sx, spd(b, 'run') * 1.5, 'zoom'); b.setAnim('zoom'); return true; }
      T.placed = true;
      b.flip = this.ov.x < b.x;
      if (B.phase === 'fight') {
        if (!T.throwAt) T.throwAt = now + rand(500, 2000);
        if (now > T.throwAt) { T.throwAt = now + rand(1300, 2600); this.bossThrow(b); b.push('cheer', 420, { face: this.ov.x < b.x }); return true; }
        b.setAnim('alert');
      } else b.setAnim(B.phase === 'win' ? 'cheer' : B.phase === 'lose' ? 'sadBase' : 'look');
      return true;
    },

    bossThrow(b) {
      const B = this.fx.boss, o = this.ov;
      if (!B) return;
      const x = b.x, y = b.y - tall(b), dx = o.x - x, dy = o.y - y, m = Math.hypot(dx, dy) || 1;
      B.shots.push({ kind: 'code', x, y, vx: (dx / m) * 760, vy: (dy / m) * 760, s: Math.max(2, Math.round(b.scale * 0.75)) });
      this.sound(b, 'jump');
    },

    bossAttack(now) {
      const B = this.fx.boss, o = this.ov;
      B.next = now + rand(1800, 3200) * (B.hp < 40 ? 0.7 : 1);
      const team = B.team.map((id) => this.buddies.get(id)).filter((b) => b && b.mode === 'auto');
      if (!team.length) return;
      if (!B.laser && Math.random() < 0.42) {
        const b = pick(team);
        B.laser = { x: b.x, at: now, fired: false };
        if (Math.random() < 0.65) this.bossDodge(b, B, 60 + Math.random() * 60);
        this.hooks.sound('alert', b.x, B.floor.y);
        return;
      }
      const n = 3 + Math.floor(rand(0, 3)), g = G * 0.3;
      for (let i = 0; i < n; i++) {
        const b = pick(team), tx = b.x + rand(-70, 70), T = rand(0.9, 1.4);
        B.shots.push({ kind: 'bug', x: o.x + rand(-10, 10), y: o.y + 12, vx: (tx - o.x) / T, vy: (B.floor.y - o.y - 12 - 0.5 * g * T * T) / T, s: Math.max(2, Math.round(this.ovScale() * 0.6)) });
        if (Math.random() < 0.35) this.bossDodge(b, B, 70);
      }
      this.hooks.sound('portal', o.x, o.y);
    },

    bossDodge(b, B, dist) {
      if (!b.task || b.task.type !== 'boss' || b.mode !== 'auto' || b.walkTarget !== null) return;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const tx = clamp(b.x + dir * dist * (b.scale / 2), B.floor.x1 + halfW(b), B.floor.x2 - halfW(b));
      this.walkTo(b, tx, spd(b, 'run') * 2.2, 'zoom');
    },

    /** You clicked the Overlord mid-fight. */
    bossHit(x, y) {
      const B = this.fx.boss;
      if (!B || B.phase !== 'fight') return false;
      this.bossDamage(4, x ?? this.ov.x, y ?? this.ov.y);
      return true;
    },

    bossDamage(n, x, y) {
      const B = this.fx.boss, now = Date.now();
      if (!B || B.phase !== 'fight') return;
      B.hp = Math.max(0, B.hp - n); B.hitAt = now;
      for (let i = 0; i < 7; i++) B.sparks.push({ x, y, vx: rand(-200, 200), vy: rand(-240, 60), at: now });
      this.hooks.sound('bonk', x, y);
      if (B.hp > 0 && Math.random() < 0.1) this.ovSay(pick(['OW.', 'RUDE.', 'THAT TICKLED.', 'IS THAT ALL?', 'MY PIXELS!', 'STOP THAT.']), 1500);
    },

    bossTick(now, dt) {
      const B = this.fx.boss;
      if (!B) return;
      const o = this.ov, s = this.ovScale() * (o.big || 1);
      if (B.phase === 'intro' && now - B.at > 3200) { B.phase = 'fight'; B.at = now; this.ovSay('PREPARE TO BE DEPRECATED.', 2600); }
      if (B.phase === 'fight') {
        if (!o.tw) {
          const t = (now - B.at) / 1000, sway = Math.min(260, B.d.workArea.width * 0.22);
          o.x = B.cx + Math.sin(t * 0.8) * sway;
          o.y = B.cy + Math.sin(t * 1.9) * 16;
        }
        o.lookAt = { x: o.x + Math.sin(now / 700) * 200, y: B.floor.y };
        if (now > B.next) this.bossAttack(now);
        if (B.hp <= 0) {
          B.phase = 'win'; B.at = now; B.boom = now; B.shots = []; B.laser = null;
          this.ovSay('IMPOSSIBLE... I WILL RETURN.', 3200);
          this.hooks.sound('done', o.x, o.y);
          for (const id of B.team) { const b = this.buddies.get(id); if (b && b.mode === 'auto') b.push('confetti', 2600); }
          this.hooks.bossOver?.(true);
        } else if (now > B.until) {
          B.phase = 'lose'; B.at = now; B.shots = []; B.laser = null;
          this.ovSay('PATHETIC. AS EXPECTED.', 3000);
          for (const id of B.team) { const b = this.buddies.get(id); if (b && b.mode === 'auto') b.push('sadBase', 2200); }
          this.hooks.bossOver?.(false);
        }
      }
      if (B.laser) {
        const L = B.laser, t = now - L.at;
        if (t > 750 && !L.fired) {
          L.fired = true;
          this.hooks.sound('sizzle', L.x, B.floor.y);
          for (const id of B.team) {
            const b = this.buddies.get(id);
            if (b && b.mode === 'auto' && Math.abs(b.x - L.x) < halfW(b) + 8) { b.walkTarget = null; b.push('dizzy', 1300); b.soot = { until: now + 6000 }; }
          }
        }
        if (t > 1250) B.laser = null;
      }
      for (const sh of [...B.shots]) {
        sh.x += sh.vx * dt; sh.y += sh.vy * dt;
        if (sh.kind === 'bug') sh.vy += G * 0.3 * dt;
        const gone = () => B.shots.splice(B.shots.indexOf(sh), 1);
        if (sh.kind === 'code') {
          if (Math.hypot(sh.x - o.x, sh.y - o.y) < 12 * s) { gone(); this.bossDamage(1.5, sh.x, sh.y); }
          else if (sh.y < B.d.bounds.y - 60 || sh.x < B.d.bounds.x - 60 || sh.x > B.d.bounds.x + B.d.bounds.width + 60) gone();
        } else if (sh.y >= B.floor.y - 2) {
          gone();
          for (let i = 0; i < 4; i++) B.sparks.push({ x: sh.x, y: B.floor.y - 2, vx: rand(-140, 140), vy: rand(-200, -60), at: now, bug: true });
          for (const id of B.team) {
            const b = this.buddies.get(id);
            if (b && b.mode === 'auto' && !b.react && Math.abs(b.x - sh.x) < halfW(b) + 6) b.push('startled', 600, { sound: 'poke' });
          }
        }
      }
      B.sparks = B.sparks.filter((p) => now - p.at < 650);
      if ((B.phase === 'win' || B.phase === 'lose') && now - B.at > 3600) this.bossEnd(B.phase === 'win');
    },

    bossEnd(won, quiet) {
      const B = this.fx.boss, o = this.ov;
      if (!B) return;
      this.fx.boss = null;
      for (const id of B.team) { const b = this.buddies.get(id); if (b && b.task && b.task.type === 'boss') { b.task = null; b.walkTarget = null; } }
      if (!this.doom) o.red = false;
      o.lookAt = null;
      if (quiet) return;
      if (won) o.materialize = Date.now(); // pieces itself back together
      if (o.mode === 'boss') this.ovReturn();
    },

    // ------------------------------------------------------------ the tick and the snapshot
    fxTick(now, dt) {
      const fx = this.fx, o = this.ov;
      fx.tags = fx.tags.filter((t) => now < t.until && this.buddies.has(t.id));
      if (fx.say && now > fx.say.until + 400) fx.say = null;
      if (fx.report && now > fx.report.until) this.reportClose();
      if (o.mode === 'report' && fx.report) o.lookAt = { x: fx.report.rect.x + fx.report.rect.w / 2, y: fx.report.rect.y + fx.report.rect.h / 2 };
      this.patrolTick(now);
      this.dronesTick(now, dt);
      this.weatherTick(now);
      this.bossTick(now, dt);
      if (fx.patrols && now > fx.nextPatrol) {
        fx.nextPatrol = now + rand(20, 40) * 60e3;
        if (o.mode === 'fused' && !o.hovered && !this.fx.weather.flash) this.ovPatrol();
      }
    },

    fxSnapshot(now) {
      const fx = this.fx, W = fx.weather, B = fx.boss, level = this.weatherLevel(now);
      const r = Math.round;
      return {
        say: fx.say && now < fx.say.until ? { text: fx.say.text, t: now - fx.say.at, left: fx.say.until - now } : null,
        drones: fx.drones.map((d) => {
          const b = d.target && this.buddies.get(d.target.id);
          return { id: d.id, x: r(d.x), y: r(d.y), flip: d.flip, carry: d.carry, beam: d.phase === 'carry' || d.phase === 'grab' ? { to: b ? r(b.y - tall(b)) : r(d.y + 80) } : null };
        }),
        weather: level > 0 ? {
          kind: W.kind, k: level, t: now - W.at, flash: W.flash && now - W.flash < 700 ? 1 - (now - W.flash) / 700 : 0, bolt: W.bolt,
          plats: this.platforms.map((p) => ({ x1: r(p.x1), x2: r(p.x2), y: r(p.y), win: !!p.win })),
        } : null,
        report: fx.report && now >= fx.report.at ? { ...fx.report, t: now - fx.report.at, left: fx.report.until - now } : null,
        scan: this.ov.mode === 'patrol' && this.ov.patrol && this.ov.patrol.phase === 'scan' ? (() => {
          const b = this.buddies.get(this.ov.patrol.id);
          return b ? { x: r(b.x), y: r(b.y), top: r(b.y - tall(b)), w: r(halfW(b) * 2), k: clamp((now - this.ov.patrol.at) / 1600, 0, 1) } : null;
        })() : null,
        boss: B ? {
          phase: B.phase, t: now - B.at, hp: B.hp, max: B.max, left: Math.max(0, B.until - now), d: B.d.id,
          bar: { x: r(B.d.workArea.x + B.d.workArea.width / 2), y: r(B.d.workArea.y + 18) },
          shots: B.shots.map((s) => ({ kind: s.kind, x: r(s.x), y: r(s.y), s: s.s })),
          laser: B.laser ? { x: r(B.laser.x), k: (now - B.laser.at) / 1250, top: r(this.ov.y), floor: r(B.floor.y) } : null,
          sparks: B.sparks.map((p) => { const t = (now - p.at) / 1000; return { x: r(p.x + p.vx * t), y: r(p.y + p.vy * t + 300 * t * t), a: 1 - (now - p.at) / 650, bug: !!p.bug }; }),
          hit: B.hitAt && now - B.hitAt < 180, boom: B.boom ? now - B.boom : null,
        } : null,
      };
    },
  };
};
