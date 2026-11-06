// Buddies being needy and naughty, mixed into World (see the end of world.js):
// - done hops: a buddy that finished its turn jumps up toward your cursor (never quite reaching it,
//   since touching it would count as hovering and clear its ✓);
// - annoy mode (per buddy, opt-in): now and then, after a while out, idle and not working, it gets up
//   to mischief. Some of it is real: it really minimizes a window, and really drags a pinned taskbar
//   app a slot over (main.js does those through the hooks below).
// The overlay draws arms reaching out (b.reach), peeking from behind a window edge (b.clipY), sticky
// notes and the fake error dialog (mischiefFx).
'use strict';

module.exports = (H) => {
  const { G, clamp, rand, pick, halfW, tall, spd } = H;
  const KINDS = ['hopper', 'insult', 'photobomb', 'shadow', 'minimize', 'closetease', 'taskbar', 'note', 'fakeerror'];
  const INSULTS = [
    'NICE VARIABLE NAME. NOT.', "I'VE SEEN FASTER TYPISTS. I'M A CRAB.", 'BOLD OF YOU TO PUSH ON A FRIDAY.', 'IS THAT A TAB OR FOUR SPACES?',
    'DID YOU TEST THAT? NO?', 'CTRL+Z IS YOUR FRIEND.', 'THAT IS A LOT OF TABS.', 'MY HELPERS DO MORE WORK THAN YOU.',
    'SO... NO DOCS THEN?', 'COMMIT MESSAGE: FIX STUFF?', 'I COULD DO THAT. WITH CLAWS.', 'WHEN DID YOU LAST STRETCH?',
    'YOUR CURSOR LOOKS TIRED.', 'I AM BORED. ENTERTAIN ME.', 'THAT BUG IS STILL THERE.', 'GREAT IDEA. SAID NOBODY.',
  ];
  const GRUMBLES = ['SO CLOSE!', 'HOLD STILL!', 'GRR.', 'NEXT TIME.', 'HOW?!', 'COME BACK!'];
  const NOTES = ['DRINK WATER', 'YOU FORGOT A SEMICOLON', 'STAND UP. STRETCH.', 'COMMIT MORE OFTEN', 'TODO: EVERYTHING', 'FEED YOUR BUDDY', 'I WAS HERE', 'BLINK.', 'NICE CODE (LIE)', 'CALL YOUR MOM'];
  const NOTE_COLOURS = ['#ffe97a', '#ffb3c7', '#b8f0c2', '#bfe3ff'];
  const BTN = 46; // a title-bar button's width (DIPs)
  /** Use a hook's answer whether it comes straight back or as a promise. */
  const settle = (v, ok, fail) => { if (v && typeof v.then === 'function') v.then(ok, fail); else ok(v); };

  return {
    // ------------------------------------------------------------ where you are
    /** Your cursor, or the middle of the focused window when the cursor is hidden. */
    userPoint() {
      const c = this.cursor;
      if (c && !c.hidden && this.displayAt(c.x, c.y)) return { x: c.x, y: c.y };
      const f = this.focusWin;
      if (f && f.rect) return { x: f.rect.x + f.rect.width / 2, y: f.rect.y + f.rect.height / 2 };
      return null;
    },

    /**
     * Hop straight up beside a point, as high as it can toward it: it never ends up touching it
     * (that would count as hovering). Walks over first. Returns 'walk', 'jump' or false.
     */
    hopToward(b, T) {
      const p = b.plat;
      if (!p || b.mode !== 'auto') return false;
      const side = b.x < T.x ? -1 : 1, off = halfW(b) + 36;
      const standX = clamp(T.x + side * off, p.x1 + halfW(b), p.x2 - halfW(b));
      if (Math.abs(b.x - standX) > 24) { this.walkTo(b, standX, spd(b, 'run') * 1.3, 'zoom'); return 'walk'; }
      let h = clamp(b.y - (T.y + tall(b) * 0.55), 40, 620);
      if (Math.abs(standX - T.x) < off - 8) h = Math.min(h, Math.max(20, b.y - T.y - tall(b) - 34)); // it'd be right under it
      this.drop(b, 'jump');
      b.vy = -Math.sqrt(2 * G * h); b.vx = 0;
      b.flip = T.x < b.x;
      b.hopKeep = true; // its ✓ stays up while it's in the air
      this.sound(b, 'jump');
      return 'jump';
    },

    // ------------------------------------------------------------ done hops
    /** A buddy whose turn is done (✓ showing) keeps jumping up at you until you hover or click it. */
    doneHopTick(b, now) {
      if (!this.doneBubble(b.session, b) || b.pinned || !b.plat || b.mode !== 'auto') { b.hop = null; return false; }
      let Hh = b.hop;
      if (!Hh) {
        Hh = b.hop = { at: now, next: now + 2600 }; // after its little celebration
        this.stopWalk(b); // whatever it was off to do can wait
      }
      if (now - Hh.at > 180e3) return false; // then it gives up and does its own thing
      const T = this.userPoint();
      if (!T) return false;
      if (b.walkTarget !== null) { b.setAnim(b.walkAnim); return true; }
      if (now < Hh.next) { b.flip = T.x < b.x; b.setAnim('alert'); return true; }
      if (this.hopToward(b, T) === 'jump') Hh.next = now + rand(1300, 2400) * (now - Hh.at > 60e3 ? 2.5 : 1);
      return true;
    },

    // ------------------------------------------------------------ annoy mode
    /** Ready for mischief: annoy mode on, out (not home), awake, idle and not working for a while. */
    mischiefCheck(b, now) {
      if (!b.annoy || b.mischief || b.pinned || !b.plat || b.sleeping || b.isMini || b.mode !== 'auto' || this.doom || this.fx.boss) return false;
      const s = b.session;
      if (s.state === 'working' || s.attention === 'permission' || s.attention === 'question' || this.doneBubble(s, b)) return false;
      if (now - (b.lastWorkAt || 0) < 90e3 || now < (this.fx.nextMischief || 0)) return false;
      if ([...this.buddies.values()].some((o) => o.mischief)) return false; // one at a time
      this.fx.nextMischief = now + rand(120, 300) * 1000;
      return this.mischiefStart(b, pick(KINDS), now);
    },

    mischiefStart(b, kind, now = Date.now()) {
      if (!b || b.mischief || !KINDS.includes(kind)) return false;
      const M = { kind, phase: 'go', at: now, until: now + 40e3, n: 0 };
      const f = this.focusWin;
      if (kind === 'photobomb' && !(f && f.rect && this.displayAt(f.rect.x + f.rect.width / 2, f.rect.y + f.rect.height - 4))) return this.mischiefStart(b, 'insult', now);
      if (kind === 'minimize' || kind === 'closetease') {
        const W = this.mischiefWindow(b);
        if (!W) return this.mischiefStart(b, kind === 'minimize' ? 'insult' : 'hopper', now);
        Object.assign(M, W);
      }
      if (kind === 'hopper') M.until = now + rand(18, 30) * 1000;
      if (kind === 'shadow') M.until = now + rand(12, 18) * 1000;
      b.mischief = M;
      b.meet = null; this.stopWalk(b);
      if (kind === 'taskbar') {
        M.phase = 'query';
        settle(this.hooks.taskbarButtons ? this.hooks.taskbarButtons() : [], (list) => { if (b.mischief === M) { M.buttons = list || []; M.phase = 'pick'; } }, () => { if (b.mischief === M) this.mischiefEnd(b); });
      }
      return true;
    },

    mischiefEnd(b) {
      const M = b.mischief;
      b.mischief = null; b.reach = null; b.clipY = undefined;
      if (b.mode === 'prank') {
        if (M && M.home) { b.x = M.home.x; b.y = M.home.y; }
        b.mode = 'air'; b.fallKind = 'drop'; b.ground = null; b.plat = null; b.vx = 0; b.vy = 0;
      }
      if (b.mode === 'wall' || b.mode === 'ceil') this.letGo(b, 'jump');
    },

    /** The window to pick on: the one you're in (or the top one) with its title-bar buttons on screen. */
    mischiefWindow(b) {
      const cands = [this.focusWin && this.winById.get(this.focusWin.id), ...this.windows].filter(Boolean);
      for (const w of cands) {
        const r = w.rect, right = r.x + r.width, top = r.y;
        const d = this.displayAt(right - 30, top + 12);
        if (!d) continue;
        const min = { x: right - BTN * 2.5, y: top + 15 }, close = { x: right - BTN / 2, y: top + 15 };
        if (w.maximized || top <= d.workArea.y + 4) {
          // Its buttons are in the top-right corner of the screen: perch up on the right edge of the screen.
          const wall = this.walls.find((x) => x.side === 'R' && Math.abs(x.x - (d.bounds.x + d.bounds.width)) < 2 && x.y1 <= d.workArea.y + 60);
          if (!wall || Math.abs(right - wall.x) > 12) continue;
          return { win: w.id, wrect: { ...r }, min, close, perch: 'wall', wall, d };
        }
        const ledge = this.platforms.find((p) => p.win === w.id && p.x1 <= min.x - 30 && p.x2 >= close.x - 10);
        if (ledge) return { win: w.id, wrect: { ...r }, min, close, perch: 'ledge', ledge, d };
      }
      return null;
    },

    /** Drives the buddy while it's up to something. Returns true while it's busy with it. */
    mischiefTick(b, now) {
      const M = b.mischief, s = b.session;
      if (!M) return false;
      if (now > M.until || s.state === 'working' || s.attention === 'permission' || s.attention === 'question' || this.doom || this.fx.boss) { this.mischiefEnd(b); return false; }
      const t = now - M.at, next = (phase) => { M.phase = phase; M.at = now; };
      const grounded = b.mode === 'auto';
      if (b.mode === 'air') return true;
      // Off the wall first (unless the wall is where this bit of mischief happens).
      if ((b.mode === 'wall' || b.mode === 'ceil') && !['minimize', 'closetease', 'shadow'].includes(M.kind)) { this.letGo(b, 'jump'); return true; }
      switch (M.kind) {
        case 'hopper': {
          if (!grounded) return true;
          const c = this.cursor && !this.cursor.hidden ? { x: this.cursor.x, y: this.cursor.y } : this.userPoint();
          if (!c) { this.mischiefEnd(b); return false; }
          if (b.walkTarget !== null) { b.setAnim(b.walkAnim); return true; }
          if (now < (M.next || 0)) { b.flip = c.x < b.x; b.setAnim('alert'); return true; }
          if (this.hopToward(b, c) === 'jump') {
            M.n++; M.next = now + rand(700, 1500);
            if (M.n % 3 === 0) b.push('sadBase', 900, { say: pick(GRUMBLES) });
          }
          return true;
        }
        case 'insult': {
          if (!grounded) return true;
          const T = this.userPoint();
          if (M.phase === 'go' && T && b.plat && Math.abs(T.x - b.x) > 260) {
            this.walkTo(b, clamp(T.x + (b.x < T.x ? -200 : 200), b.plat.x1 + halfW(b), b.plat.x2 - halfW(b)), spd(b, 'walk') * 1.4);
            next('walk'); b.setAnim('walk'); return true;
          }
          // Far away? After a few seconds' walk it just says it from where it is.
          if (b.walkTarget !== null && t < 6000) { b.setAnim(b.walkAnim); return true; }
          b.walkTarget = null;
          b.push('talk', 3000, { say: pick(INSULTS), face: T ? T.x < b.x : b.flip, sound: 'chat' });
          b.push('cheer', 600);
          this.mischiefEnd(b);
          return true;
        }
        case 'note': {
          if (!grounded) return true;
          const d = this.displayAt(b.x, b.y - 2) || this.nearestDisplay(b.x, b.y);
          const w = 130, h = 96;
          const x = clamp(b.x + rand(-160, 160) - w / 2, d.workArea.x + 12, d.workArea.x + d.workArea.width - w - 12);
          const y = clamp(b.y - tall(b) - rand(90, 260), d.workArea.y + 12, d.workArea.y + d.workArea.height - h - 40);
          const notes = this.fx.notes || (this.fx.notes = []);
          notes.push({ id: ++this.itemSeq, x, y, w, h, text: pick(NOTES), c: pick(NOTE_COLOURS), at: now, by: b.id });
          if (notes.length > 4) notes.shift();
          b.flip = x + w / 2 < b.x;
          b.push('cheer', 700, { sound: 'stamp' });
          this.mischiefEnd(b);
          return true;
        }
        case 'fakeerror': {
          if (!grounded) return true;
          const f = this.focusWin, d = this.displayAt(b.x, b.y - 2) || this.nearestDisplay(b.x, b.y);
          const area = f && f.rect && this.displayAt(f.rect.x + f.rect.width / 2, f.rect.y + f.rect.height / 2) ? f.rect : { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height };
          const w = 340, h = 132;
          this.fx.fakeError = { x: area.x + area.width / 2 - w / 2, y: area.y + area.height / 2 - h / 2, w, h, at: now, until: now + 45e3, by: b.id };
          this.sound(b, 'error');
          b.push('cheer', 900, { say: 'HEH HEH.' });
          this.mischiefEnd(b);
          return true;
        }
        case 'photobomb': {
          const f = this.focusWin;
          if (M.phase === 'go') {
            if (!grounded || !f) { if (!f) this.mischiefEnd(b); return !!f; }
            const d = this.displayAt(f.rect.x + f.rect.width / 2, f.rect.y + f.rect.height - 4);
            if (!d) { this.mischiefEnd(b); return false; }
            M.home = { x: b.x, y: b.y };
            M.edge = Math.min(f.rect.y + f.rect.height, this.floorY(d));
            M.px = f.rect.x + f.rect.width * rand(0.25, 0.75);
            b.mode = 'prank'; b.walkTarget = null; b.react = null;
            next('fade');
            return true;
          }
          const hgt = tall(b);
          if (M.phase === 'fade') { b.alpha = Math.max(0, 1 - t / 350); b.setAnim('ninja'); if (t > 350) { b.x = M.px; b.y = M.edge + hgt; b.clipY = M.edge; b.alpha = 1; b.flip = false; next('rise'); } return true; }
          if (M.phase === 'rise') { b.y = M.edge + hgt * (1 - Math.min(1, t / 450)); b.setAnim('look'); if (t > 450) { next('wave'); this.sound(b, 'greet'); } return true; }
          if (M.phase === 'wave') { b.y = M.edge; b.setAnim('wave'); if (t > 2000) next('duck'); return true; }
          if (M.phase === 'duck') { b.y = M.edge + hgt * Math.min(1, t / 380); if (t > 380) { b.alpha = 0; this.mischiefEnd(b); } return true; }
          return true;
        }
        case 'shadow': {
          const c = this.cursor;
          if (!c || c.hidden) { this.mischiefEnd(b); return false; }
          if (M.phase === 'go') {
            if (b.mode === 'wall' || b.mode === 'ceil') this.uprightFrom(b);
            b.mode = 'prank'; b.walkTarget = null; M.px = c.x; M.py = c.y; M.dx = 1; M.dy = 0; next('follow');
          }
          // Trail behind the cursor's movement, keeping a little gap (touching it would count as hovering).
          const vx = c.x - M.px, vy = c.y - M.py, m = Math.hypot(vx, vy);
          if (m > 2) { M.dx = M.dx * 0.8 + (vx / m) * 0.2; M.dy = M.dy * 0.8 + (vy / m) * 0.2; }
          M.px = c.x; M.py = c.y;
          const dm = Math.hypot(M.dx, M.dy) || 1, gap = halfW(b) + 46;
          const tx = c.x - (M.dx / dm) * gap, ty = c.y - (M.dy / dm) * gap + tall(b) / 2;
          b.x += (tx - b.x) * 0.18; b.y += (ty - b.y) * 0.18;
          // Never closer than the gap, even when the cursor turns back toward it: it slides around instead.
          const cx = b.x - c.x, cy = b.y - tall(b) / 2 - c.y, cm = Math.hypot(cx, cy) || 1, min = gap * 0.8;
          if (cm < min) { b.x = c.x + (cx / cm) * min; b.y = c.y + (cy / cm) * min + tall(b) / 2; }
          const d = this.displayAt(b.x, b.y - tall(b) / 2) || this.nearestDisplay(b.x, b.y);
          b.x = clamp(b.x, d.bounds.x + halfW(b), d.bounds.x + d.bounds.width - halfW(b));
          b.y = clamp(b.y, d.bounds.y + tall(b), this.floorY(d));
          b.flip = c.x < b.x;
          b.setAnim(m > 4 ? 'walk' : 'look');
          return true;
        }
        case 'minimize': case 'closetease': return this.titleButtonTick(b, M, now, t, next);
        case 'taskbar': return this.taskbarTick(b, M, now, t, next);
      }
      return false;
    },

    /** Stare at a window's minimize (or close) button, reach out ever so slowly, and click it (or not). */
    titleButtonTick(b, M, now, t, next) {
      const target = M.kind === 'minimize' ? M.min : M.close;
      const w = this.winById.get(M.win);
      const moved = !w || Math.abs(w.rect.x + w.rect.width - (M.wrect.x + M.wrect.width)) > 16 || Math.abs(w.rect.y - M.wrect.y) > 16;
      if (moved && M.phase !== 'after') { this.mischiefEnd(b); return false; }
      if (M.phase === 'go') {
        if (M.perch === 'ledge') {
          if (b.mode === 'wall' || b.mode === 'ceil') { this.letGo(b, 'jump'); return true; }
          if (b.mode !== 'auto') return true;
          const p = this.platforms.find((q) => q.key === M.ledge.key) || this.platforms.find((q) => q.win === M.win && q.x1 <= target.x && q.x2 >= target.x - 60);
          if (!p) { this.mischiefEnd(b); return false; }
          const standX = clamp(M.kind === 'minimize' ? target.x + BTN * 0.9 : target.x - BTN * 1.1, p.x1 + halfW(b), p.x2 - halfW(b));
          if (b.plat && b.plat.key === p.key) {
            if (Math.abs(b.x - standX) > 4) { if (b.walkTarget === null) this.walkTo(b, standX, spd(b, 'sneak') * 1.6, 'ninja'); b.setAnim(b.walkAnim); return true; }
            b.walkTarget = null; next('stare'); return true;
          }
          if (!M.leapt || now - M.leapt > 1700) { M.leapt = now; this.leapTo(b, standX, p); }
          return true;
        }
        // Up the right edge of the screen to the top corner.
        if (b.mode === 'wall' && b.wall && b.wall.side === 'R' && Math.abs(b.wall.x - M.wall.x) < 2) {
          if (b.y <= M.wall.y1 + tall(b) + 12 || (b.cdir === 0 && now >= b.clingUntil && b.y < M.wall.y1 + 140)) { b.cdir = 0; b.clingUntil = Infinity; next('stare'); return true; }
          b.cdir = -1; b.climbStop = M.wall.y1 + tall(b) + 6;
          b.setAnim('walk');
          return true;
        }
        if (b.mode === 'ceil' || b.mode === 'wall') { this.letGo(b, 'jump'); return true; }
        if (b.mode !== 'auto') return true;
        const floor = this.platforms.find((p) => !p.win && Math.abs(p.x2 - M.wall.x) < 3 && Math.abs(p.y - this.floorY(M.d)) < 3);
        if (!floor) { this.mischiefEnd(b); return false; }
        if (!b.plat || b.plat.key !== floor.key) { if (!M.leapt || now - M.leapt > 1700) { M.leapt = now; this.leapTo(b, floor.x2 - 80, floor); } return true; }
        if (b.walkTarget === null || !b.exit) {
          this.walkTo(b, floor.x2 + 60, spd(b, 'run'), 'zoom');
          b.exit = 'R'; b.exitKind = 'climb'; b.climbPlan = { next: 'down', frac: 0.98 };
        }
        b.setAnim(b.walkAnim);
        return true;
      }
      // At the perch: the buddy looks at the button and reaches for it.
      if (b.mode === 'auto') { b.walkTarget = null; b.flip = target.x < b.x; }
      if (b.mode === 'wall') { b.cdir = 0; b.clingUntil = Infinity; }
      if (M.phase === 'stare') {
        b.setAnim('look'); b.bubble = t > 900 ? '?' : null;
        if (t > 2700) next('reach');
        return true;
      }
      if (M.phase === 'reach') {
        b.bubble = null;
        const k = Math.min(1, t / 2600);
        b.reach = { x: target.x, y: target.y, k: k * k * (3 - 2 * k) };
        b.setAnim(b.mode === 'wall' ? 'look' : 'idle');
        if (t > 2600) next('hold');
        return true;
      }
      if (M.phase === 'hold') {
        b.reach = { x: target.x, y: target.y, k: 1 };
        if (M.kind === 'minimize' && t > 450) {
          this.hooks.minimize?.(M.win);
          this.sound(b, 'chirp');
          next('after');
          M.said = pick(['OOPS.', 'HEH.', 'WHERE DID IT GO?', 'TIDY!']);
        } else if (M.kind === 'closetease' && t > 1100) {
          next('after');
          M.said = 'JUST KIDDING.';
        }
        return true;
      }
      if (M.phase === 'after') {
        const k = 1 - Math.min(1, t / 600);
        b.reach = k > 0 ? { x: target.x, y: target.y, k } : null;
        if (t > 600) {
          const said = M.said;
          this.mischiefEnd(b);
          if (b.mode === 'auto') b.push('cheer', 2400, { say: said, sound: 'done' });
          else b.queue.push({ anim: 'cheer', dur: 2400, say: said });
        }
        return true;
      }
      return true;
    },

    /** Walk over to a pinned taskbar app and, with an outstretched arm, slowly drag it a slot over. */
    taskbarTick(b, M, now, t, next) {
      if (M.phase === 'query') { b.setAnim('look'); return true; }
      if (b.mode === 'wall' || b.mode === 'ceil') { this.letGo(b, 'jump'); return true; }
      if (b.mode !== 'auto') return true;
      if (M.phase === 'pick') {
        const list = (M.buttons || []).slice().sort((x, y) => x.x - y.x);
        if (list.length < 2) { this.mischiefEnd(b); return false; }
        const i = Math.floor(rand(0, list.length - 1)), dir = Math.random() < 0.5 && i > 0 ? -1 : 1, j = clamp(i + dir, 0, list.length - 1);
        const a = list[i], c = list[j], dd = Math.sign(c.x - a.x) || 1;
        M.from = { x: a.x + a.w / 2, y: a.y + a.h / 2 }; M.to = { x: c.x + c.w / 2 + dd * 6, y: c.y + c.h / 2 }; M.dir = dd;
        M.floor = this.platforms.find((p) => !p.win && M.from.x >= p.x1 && M.from.x <= p.x2 && p.y <= a.y + 4 && p.y >= a.y - 30);
        if (!M.floor) { this.mischiefEnd(b); return false; }
        next('walk');
      }
      const standX = (x) => clamp(x - M.dir * (halfW(b) + 8), M.floor.x1 + halfW(b), M.floor.x2 - halfW(b));
      if (M.phase === 'walk') {
        if (!b.plat || b.plat.key !== M.floor.key) { if (!M.leapt || now - M.leapt > 1700) { M.leapt = now; this.leapTo(b, standX(M.from.x), M.floor); } return true; }
        const sx = standX(M.from.x);
        if (Math.abs(b.x - sx) > 4) { if (b.walkTarget === null) this.walkTo(b, sx, spd(b, 'walk') * 1.4); b.setAnim(b.walkAnim); return true; }
        b.walkTarget = null; b.flip = M.dir < 0; next('reach');
        return true;
      }
      if (M.phase === 'reach') {
        const k = Math.min(1, t / 1600);
        b.reach = { x: M.from.x, y: M.from.y, k: k * k * (3 - 2 * k) };
        b.setAnim('idle');
        if (t > 1700) {
          next('drag');
          M.result = null;
          settle(this.hooks.taskbarDrag ? this.hooks.taskbarDrag(M.from, M.to, 2600) : { ok: false },
            (r) => { if (b.mischief === M) M.result = r || { ok: false }; },
            () => { if (b.mischief === M) M.result = { ok: false }; });
        }
        return true;
      }
      if (M.phase === 'drag') {
        // It walks along with the icon it's pulling; its hand is wherever the (real) cursor is.
        const c = this.cursor;
        b.reach = { x: c.x, y: c.y, k: 1 };
        if (b.walkTarget === null && !M.walked) { M.walked = true; this.walkTo(b, standX(M.to.x), Math.max(8, Math.abs(M.to.x - M.from.x) / 2.6), 'walk'); }
        b.setAnim(b.walkTarget !== null ? 'walk' : 'idle');
        if (M.result) { M.said = M.result.ok ? pick(['MUCH BETTER.', 'THERE.', 'YOU ARE WELCOME.']) : 'FINE. KEEP IT.'; next('after'); }
        if (t > 15000) { M.said = 'HMPH.'; next('after'); }
        return true;
      }
      if (M.phase === 'after') {
        const k = 1 - Math.min(1, t / 500);
        b.reach = k > 0 ? { x: M.to.x, y: M.to.y, k } : null;
        if (t > 500) { const said = M.said; this.mischiefEnd(b); b.push('cheer', 2300, { say: said, sound: 'done' }); }
        return true;
      }
      return true;
    },

    // ------------------------------------------------------------ clicking its pranks away
    noteOff(id) {
      const notes = this.fx.notes || [];
      const n = notes.find((x) => x.id === id);
      if (!n) return false;
      this.fx.notes = notes.filter((x) => x !== n);
      const b = this.buddies.get(n.by);
      if (b && b.mode === 'auto' && !b.react && Math.random() < 0.5) b.push('sadBase', 900);
      return true;
    },

    fakeErrorOk() {
      const E = this.fx.fakeError;
      if (!E) return false;
      this.fx.fakeError = null;
      const b = this.buddies.get(E.by);
      if (b && b.mode === 'auto') b.push('cheer', 1800, { say: pick(['GOTCHA!', 'MADE YOU CLICK.', 'HA!']), sound: 'done' });
      return true;
    },

    mischiefFx(now) {
      const fx = this.fx;
      if (fx.fakeError && now > fx.fakeError.until) fx.fakeError = null;
      const r = Math.round;
      return {
        notes: (fx.notes || []).map((n) => ({ id: n.id, x: r(n.x), y: r(n.y), w: n.w, h: n.h, text: n.text, c: n.c, t: now - n.at })),
        fakeError: fx.fakeError ? { x: r(fx.fakeError.x), y: r(fx.fakeError.y), w: fx.fakeError.w, h: fx.fakeError.h, t: now - fx.fakeError.at } : null,
      };
    },
  };
};
