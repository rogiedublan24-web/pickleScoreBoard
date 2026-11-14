/* ==========================================================
   Pickleball Scoreboard — script.js
   Sections:
     1. Config
     2. Rules            (pure functions: scoring + server logic)
     3. App state        (current game, history for undo, names, results)
     4. DOM references
     5. Render           (includes auto-fit for team names)
     6. Standings
     7. Actions          (add point, side out, undo, reset, mode)
     8. Dialogs & toast
     9. Storage
    10. Events & init
   ========================================================== */
(() => {
  'use strict';

  /* ---------- 1. Config ---------- */
  const CONFIG = {
    winScore: 11,            // points needed to win
    winBy: 1,                // 1 = game ends exactly at 11. Use 2 for the official win-by-2 rule.
    callServerFirst: true,   // true: call "server-receiver-#" (official). false: "Left-Right-#"
    defaultNames: ['Left team', 'Right team'], // shown in messages while a name box is still empty
    minNameFont: 10,         // smallest font size (px) the team name may shrink to
    maxHistory: 300,
    storageKey: 'pickleball-scoreboard-v3',    // change this to wipe everything saved in the browser
  };

  /* ---------- 2. Rules (pure — no DOM here) ----------
     A game state looks like:
       { mode: 'doubles' | 'singles',
         scores: [left, right],
         serving: 0 | 1,          // index of the serving team
         server: 1 | 2,           // doubles only: which partner is serving
         winner: null | 0 | 1 }
  */
  const isDoubles = (s) => s.mode === 'doubles';
  const other = (team) => 1 - team;
  const cloneState = (s) => ({ ...s, scores: [...s.scores] });

  // Doubles starts 0-0-2 (first serving team only gets one server). Singles has no server number.
  function newGame(mode) {
    return {
      mode,
      scores: [0, 0],
      serving: 0,
      server: isDoubles({ mode }) ? 2 : 1,
      winner: null,
    };
  }

  function findWinner(scores) {
    const [a, b] = scores;
    if (Math.max(a, b) >= CONFIG.winScore && Math.abs(a - b) >= CONFIG.winBy) {
      return a > b ? 0 : 1;
    }
    return null;
  }

  // Only the serving team can score. Returns a new state, or null if the move isn't allowed.
  function addPoint(state, team) {
    if (state.winner !== null || team !== state.serving) return null;
    const next = cloneState(state);
    next.scores[team] += 1;
    next.winner = findWinner(next.scores);
    return next;
  }

  /* SERVER SWITCHING — customize here.
     Doubles, the serving side lost the rally:
       • Server 1 faults  -> partner serves:  same team, server = 2
       • Server 2 faults  -> side out:        other team, server = 1
     Singles: any lost rally -> other player serves.
     Because a new game starts at server 2, the very first fault is
     automatically a side out (the "0-0-2" start rule). */
  function sideOut(state) {
    if (state.winner !== null) return null;
    const next = cloneState(state);
    if (isDoubles(state) && state.server === 1) {
      next.server = 2;
    } else {
      next.serving = other(state.serving);
      next.server = 1;
    }
    return next;
  }

  // What the Side Out button will do next (used for its label).
  function describeSideOut(state, names) {
    if (isDoubles(state) && state.server === 1) {
      return { title: 'Switch Server', sub: `${names[state.serving]}: Server 1 → Server 2` };
    }
    const nextTeam = names[other(state.serving)];
    return {
      title: 'Side Out',
      sub: isDoubles(state) ? `${nextTeam} serves next (Server 1)` : `${nextTeam} serves next`,
    };
  }

  function scoreCall(state) {
    const nums = CONFIG.callServerFirst
      ? [state.scores[state.serving], state.scores[other(state.serving)]]
      : [state.scores[0], state.scores[1]];
    if (isDoubles(state)) nums.push(state.server);
    return nums.join('-');
  }

  function callHint(state, names) {
    if (state.winner !== null) return `${names[state.winner]} wins`;
    const who = names[state.serving];
    if (isDoubles(state)) return `${who} serving · Server ${state.server}`;
    const court = state.scores[state.serving] % 2 === 0 ? 'right (even)' : 'left (odd)';
    return `${who} serving from the ${court} court`;
  }

  /* ---------- 3. App state ---------- */
  const app = {
    names: ['', ''],      // what the user typed (empty until they type something)
    state: newGame('doubles'),
    history: [],          // snapshots of previous game states (for Undo)
    results: [],          // finished games: { names: [a, b], scores: [a, b], winner: 0 | 1 }
    winDismissed: false,  // user closed the win banner to view the board
  };
  let lastRenderedScores = [0, 0];

  // Names used in messages: the typed name, or "Left team" / "Right team" while the box is empty.
  const displayNames = () => app.names.map((n, i) => n.trim() || CONFIG.defaultNames[i]);

  // Every change goes through here so Undo always works.
  function commit(next) {
    const wasOver = app.state.winner !== null;
    app.history.push(cloneState(app.state));
    if (app.history.length > CONFIG.maxHistory) app.history.shift();
    if (next.winner !== null && !wasOver) {
      app.winDismissed = false;
      // Game just ended: record the result for the standings.
      app.results.push({ names: displayNames(), scores: [...next.scores], winner: next.winner });
    }
    app.state = next;
    buzz();
    render();
    save();
  }

  /* ---------- 4. DOM references ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    teams: $('teams'),
    cards: [...document.querySelectorAll('.team')],
    names: [$('name-0'), $('name-1')],
    scores: [$('score-0'), $('score-1')],
    chips: [...document.querySelectorAll('.serve-chip')],
    pointBtns: [...document.querySelectorAll('.point-btn')],
    modeBtns: [...document.querySelectorAll('.seg')],
    call: $('score-call'),
    callLabel: $('call-label'),
    callHint: $('call-hint'),
    sideOut: $('side-out'),
    sideOutTitle: $('side-out-title'),
    sideOutSub: $('side-out-sub'),
    undo: $('undo'),
    reset: $('reset'),
    standingsWrap: $('standings-wrap'),
    standingsBody: $('standings-body'),
    standingsEmpty: $('standings-empty'),
    standingsClear: $('standings-clear'),
    winModal: $('win-modal'),
    winTitle: $('win-title'),
    winScore: $('win-score'),
    winUndo: $('win-undo'),
    winNew: $('win-new'),
    winClose: $('win-close'),
    confirmModal: $('confirm-modal'),
    confirmTitle: $('confirm-title'),
    confirmMsg: $('confirm-msg'),
    confirmOk: $('confirm-ok'),
    confirmCancel: $('confirm-cancel'),
    toast: $('toast'),
  };

  /* ---------- 5. Render ---------- */
  function canPickFirstServer() {
    const s = app.state;
    return app.history.length === 0 && s.winner === null && s.scores[0] === 0 && s.scores[1] === 0;
  }

  /* AUTO-FIT TEAM NAME
     Starts from the font size set in CSS, then shrinks one half-pixel at a time
     until the text fits inside the input (down to CONFIG.minNameFont).
     A hidden <span> is used to measure the text width. */
  const meter = document.createElement('span');
  meter.setAttribute('aria-hidden', 'true');
  meter.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;';
  document.body.appendChild(meter);

  function fitName(input) {
    input.style.fontSize = '';                       // go back to the CSS size
    const cs = getComputedStyle(input);
    const base = parseFloat(cs.fontSize);
    const avail = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!(avail > 0) || !(base > 0)) return;

    const spacingPx = parseFloat(cs.letterSpacing);  // NaN when "normal"
    meter.style.fontFamily = cs.fontFamily;
    meter.style.fontWeight = cs.fontWeight;
    meter.style.textTransform = cs.textTransform;
    meter.style.letterSpacing = Number.isNaN(spacingPx) ? '0' : `${spacingPx / base}em`;
    meter.textContent = input.value || '';

    let size = base;
    meter.style.fontSize = `${size}px`;
    while (meter.offsetWidth > avail && size > CONFIG.minNameFont) {
      size -= 0.5;
      meter.style.fontSize = `${size}px`;
    }
    if (size !== base) input.style.fontSize = `${size}px`;
  }

  const fitNames = () => els.names.forEach(fitName);

  function render() {
    const s = app.state;
    const names = displayNames();
    const playing = s.winner === null;
    const pickFirst = canPickFirstServer();

    // Mode toggle
    els.modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode)));

    // Score call
    els.callLabel.textContent = CONFIG.callServerFirst ? 'Score call · server first' : 'Score call';
    els.call.textContent = scoreCall(s);
    els.callHint.textContent = callHint(s, names);

    // Team cards
    [0, 1].forEach((i) => {
      const isServing = playing && s.serving === i;

      // Keep the input box in sync with what was typed (blank until the user types)
      if (document.activeElement !== els.names[i] && els.names[i].value !== app.names[i]) {
        els.names[i].value = app.names[i];
      }

      els.cards[i].classList.toggle('serving', isServing);
      els.cards[i].classList.toggle('winner', s.winner === i);

      els.scores[i].textContent = s.scores[i];
      if (s.scores[i] !== lastRenderedScores[i]) {
        els.scores[i].classList.remove('bump');
        void els.scores[i].offsetWidth; // restart animation
        els.scores[i].classList.add('bump');
      }

      els.chips[i].textContent = isServing
        ? (isDoubles(s) ? `Serving · Server ${s.server}` : 'Serving')
        : (s.winner === i ? 'Winner' : 'Receiving');
      els.chips[i].classList.toggle('is-serving', isServing);
      els.chips[i].classList.toggle('editable', pickFirst && !isServing);

      els.pointBtns[i].classList.toggle('locked', !isServing);
      els.pointBtns[i].setAttribute('aria-disabled', String(!isServing));
    });
    lastRenderedScores = [...s.scores];

    // Team names: shrink the font if a name is too long
    fitNames();

    // Side Out button
    const d = describeSideOut(s, names);
    els.sideOutTitle.textContent = d.title;
    els.sideOutSub.textContent = d.sub;
    els.sideOut.disabled = !playing;

    // Undo
    els.undo.disabled = app.history.length === 0;

    // Standings panel (always on screen)
    renderStandings();

    // Win banner
    const showWin = s.winner !== null && !app.winDismissed;
    els.winModal.hidden = !showWin;
    if (s.winner !== null) {
      els.winTitle.textContent = `${names[s.winner]} wins!`;
      els.winScore.textContent = `${s.scores[0]} – ${s.scores[1]}`;
    }
  }

  /* ---------- 6. Standings ----------
     Built from app.results. Teams are matched by name (case-insensitive).
     Sorted by wins, then point difference, then name. */
  function computeStandings() {
    const table = new Map();
    const entry = (name) => {
      const key = name.trim().toLowerCase();
      if (!table.has(key)) table.set(key, { name, w: 0, l: 0, pf: 0, pa: 0 });
      return table.get(key);
    };

    app.results.forEach((r) => {
      [0, 1].forEach((i) => {
        const t = entry(r.names[i]);
        t.pf += r.scores[i];
        t.pa += r.scores[other(i)];
        if (r.winner === i) t.w += 1; else t.l += 1;
      });
    });

    return [...table.values()].sort((a, b) =>
      (b.w - a.w) || ((b.pf - b.pa) - (a.pf - a.pa)) || a.name.localeCompare(b.name));
  }

  function renderStandings() {
    const rows = computeStandings();
    els.standingsBody.textContent = '';

    rows.forEach((t, i) => {
      const diff = t.pf - t.pa;
      const cells = [String(i + 1), t.name, String(t.w), String(t.l), `${diff > 0 ? '+' : ''}${diff}`];
      const tr = document.createElement('tr');
      if (i === 0 && t.w > 0) tr.className = 'leader';
      cells.forEach((text, c) => {
        const td = document.createElement('td');
        td.textContent = text;               // textContent: names typed by the user are never treated as HTML
        if (c === 1) td.className = 'left name';
        tr.appendChild(td);
      });
      els.standingsBody.appendChild(tr);
    });

    const empty = rows.length === 0;
    els.standingsWrap.hidden = empty;
    els.standingsEmpty.hidden = !empty;
    els.standingsClear.disabled = empty;
  }

  async function handleClearStandings() {
    const ok = await confirmDialog({
      title: 'Clear standings?',
      message: 'This deletes every recorded game result. The current game is not affected.',
      confirmText: 'Clear',
    });
    if (!ok) return;
    app.results = [];
    save();
    renderStandings();
  }

  /* ---------- 7. Actions ---------- */
  function handlePoint(team) {
    const s = app.state;
    if (s.winner !== null) return;
    const next = addPoint(s, team);
    if (!next) {
      toast(`Only the serving team scores. If ${displayNames()[team]} won the rally, tap “Side Out”.`);
      return;
    }
    commit(next);
  }

  function handleSideOut() {
    const next = sideOut(app.state);
    if (next) commit(next);
  }

  function handleUndo() {
    if (!app.history.length) return;
    // Undoing the winning point also removes that game from the standings.
    if (app.state.winner !== null) app.results.pop();
    app.state = app.history.pop();
    app.winDismissed = false;
    buzz();
    render();
    save();
  }

  function startNewGame(mode = app.state.mode) {
    app.state = newGame(mode);
    app.history = [];
    app.winDismissed = false;
    lastRenderedScores = [0, 0];
    render();
    save();
  }

  async function handleReset() {
    const ok = await confirmDialog({
      title: 'Reset game?',
      message: 'This sets the score back to 0-0 and clears the undo history.',
      confirmText: 'Reset',
    });
    if (ok) startNewGame();
  }

  async function handleModeChange(mode) {
    if (mode === app.state.mode) return;
    const inProgress = app.history.length > 0;
    if (inProgress) {
      const ok = await confirmDialog({
        title: `Switch to ${mode}?`,
        message: 'This starts a new game and the current score will be lost.',
        confirmText: 'Switch',
      });
      if (!ok) return;
    }
    startNewGame(mode);
  }

  // Before the first point you can tap the other team's chip to choose who serves first.
  function setFirstServer(team) {
    if (!canPickFirstServer() || app.state.serving === team) return;
    app.state.serving = team;
    render();
    save();
  }

  /* ---------- 8. Dialogs & toast ---------- */
  function confirmDialog({ title, message, confirmText = 'Confirm' }) {
    return new Promise((resolve) => {
      els.confirmTitle.textContent = title;
      els.confirmMsg.textContent = message;
      els.confirmOk.textContent = confirmText;
      els.confirmModal.hidden = false;
      els.confirmCancel.focus(); // safest default: Cancel

      const close = (result) => {
        els.confirmModal.hidden = true;
        els.confirmOk.onclick = els.confirmCancel.onclick = els.confirmModal.onclick = null;
        resolve(result);
      };
      els.confirmOk.onclick = () => close(true);
      els.confirmCancel.onclick = () => close(false);
      els.confirmModal.onclick = (e) => { if (e.target === els.confirmModal) close(false); };
    });
  }

  let toastTimer;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function buzz() {
    try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) { /* ignore */ }
  }

  /* ---------- 9. Storage ---------- */
  function save() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        names: app.names,
        state: app.state,
        history: app.history,
        results: app.results,
      }));
    } catch (_) { /* storage may be blocked; the app still works */ }
  }

  function validState(s) {
    return s
      && (s.mode === 'doubles' || s.mode === 'singles')
      && Array.isArray(s.scores) && s.scores.length === 2
      && s.scores.every((n) => Number.isInteger(n) && n >= 0)
      && (s.serving === 0 || s.serving === 1)
      && (s.server === 1 || s.server === 2)
      && (s.winner === null || s.winner === 0 || s.winner === 1);
  }

  function validResult(r) {
    return r
      && Array.isArray(r.names) && r.names.length === 2 && r.names.every((n) => typeof n === 'string')
      && Array.isArray(r.scores) && r.scores.length === 2
      && r.scores.every((n) => Number.isInteger(n) && n >= 0)
      && (r.winner === 0 || r.winner === 1);
  }

  function load() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!validState(data.state)) return;
      app.state = data.state;
      app.history = Array.isArray(data.history) ? data.history.filter(validState) : [];
      app.results = Array.isArray(data.results) ? data.results.filter(validResult) : [];
      if (Array.isArray(data.names) && data.names.length === 2) {
        app.names = data.names.map((n) => (typeof n === 'string' ? n : ''));
      }
      lastRenderedScores = [...app.state.scores];
    } catch (_) { /* ignore corrupt data */ }
  }

  /* ---------- 10. Events & init ---------- */
  els.teams.addEventListener('click', (e) => {
    const point = e.target.closest('.point-btn');
    if (point) return handlePoint(Number(point.dataset.team));
    const chip = e.target.closest('.serve-chip');
    if (chip) setFirstServer(Number(chip.dataset.team));
  });

  els.names.forEach((input, i) => {
    input.addEventListener('input', () => {
      app.names[i] = input.value;
      save();
      render();
    });
    input.addEventListener('blur', () => {
      // Tidy up stray spaces; an empty box simply shows the placeholder again.
      app.names[i] = input.value.trim();
      input.value = app.names[i];
      save();
      render();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('focus', () => input.select());
  });

  els.modeBtns.forEach((b) => b.addEventListener('click', () => handleModeChange(b.dataset.mode)));
  els.sideOut.addEventListener('click', handleSideOut);
  els.undo.addEventListener('click', handleUndo);
  els.reset.addEventListener('click', handleReset);
  els.standingsClear.addEventListener('click', handleClearStandings);

  els.winUndo.addEventListener('click', handleUndo);
  els.winNew.addEventListener('click', () => startNewGame());
  els.winClose.addEventListener('click', () => { app.winDismissed = true; render(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.confirmModal.hidden) els.confirmCancel.click();
  });

  // Re-fit team names when the screen size changes (rotate phone, resize window)
  // and again once the web font has finished loading.
  window.addEventListener('resize', fitNames);
  window.addEventListener('orientationchange', fitNames);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitNames);

  // Keep the screen awake during a game (where supported).
  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) { /* not supported or denied */ }
  }
  document.addEventListener('pointerdown', keepAwake, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });

  load();
  render();
})();
