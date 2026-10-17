// BOOG75 Configurator UI (vanilla JS, no dependencies).
(function () {
  'use strict';
  const APP_VERSION = '1.1.0';
  const B = window.Boog;
  const P = B.protocol, L = B.layout, K = B.keycodes, Pr = B.profile, VK = K.VK;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  }
  const mm = (tenths) => (tenths / 10).toFixed(1);
  const oneLine = (s) => String(s).replace(/\n/g, ' ');
  const keyName = (idx) => oneLine(K.label(L.defaultLayers[0][idx]));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('boog75.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('boog75.' + k, JSON.stringify(v)); } catch (e) { toast('Could not save to browser storage: ' + e.message, 'err'); } },
  };

  function toast(msg, kind) {
    const t = h('div', { class: 'toast ' + (kind || ''), role: kind === 'err' ? 'alert' : 'status', onclick: () => t.remove() }, msg);
    $('toasts').append(t);
    while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), kind === 'err' ? 10000 : 3500);
  }

  // Generic modal. buttons: [{label, value, class}] -> resolves with value (or null on Esc).
  function dialog(title, body, buttons) {
    const dlg = $('dialog'), form = $('dialog-body');
    if (dlg.open) dlg.close();
    const btns = buttons || [{ label: 'Close', value: null }];
    form.replaceChildren(h('h3', null, title), body, h('div', { class: 'actions' },
      btns.map((b) => h('button', { value: String(b.value), class: b.class || '', type: 'submit' }, b.label))));
    return new Promise((resolve) => {
      const onClose = () => {
        dlg.removeEventListener('close', onClose);
        const btn = btns.find((b) => String(b.value) === dlg.returnValue);
        resolve(btn ? btn.value : null);
      };
      dlg.returnValue = '';
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      // Focus the input if any; for destructive confirmations focus Cancel so Enter is safe.
      const focus = form.querySelector('input:not([type=hidden])')
        || form.querySelector(btns.some((b) => b.class === 'danger') ? '.actions button' : '.actions button:last-child');
      if (focus) focus.focus();
    });
  }
  async function confirmDlg(title, text, okLabel, danger) {
    const v = await dialog(title, h('p', null, text), [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, class: danger ? 'danger' : 'accent' }]);
    return v === true;
  }
  async function promptDlg(title, value, maxLen) {
    const input = h('input', { type: 'text', value: value || '', maxLength: maxLen || 40, style: { width: '100%' } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('dialog').close('true'); } });
    setTimeout(() => input.select(), 0);
    const v = await dialog(title, input, [{ label: 'Cancel', value: false }, { label: 'OK', value: true, class: 'accent' }]);
    const text = input.value.trim();
    return v === true && text ? text : null;
  }
  async function pickKeycodeDlg(title, current, opts) {
    let chosen = null;
    const dlg = $('dialog');
    const body = h('div', null, renderPicker({ current, includeMacros: opts && opts.includeMacros, onPick: (vk, ext) => { chosen = { vk, ext }; dlg.close('pick'); } }));
    const v = await dialog(title, body, [{ label: 'Cancel', value: false }, ...(opts && opts.allowClear ? [{ label: 'Clear', value: 'clear' }] : [])]);
    if (v === 'clear') return { vk: 0, ext: 0 };
    return chosen;
  }

  // ------------------------------------------------------------- state
  const S = {
    profiles: [],
    activeUid: null,
    known: store.get('known', {}) || {},
    settings: Object.assign({ autoApply: false, firstRunDismissed: false, logEnabled: false, dryRun: false, theme: null, extraEffects: false }, store.get('settings', {})),
    history: {},
    tab: 'keymap',
    layer: 0,
    selKey: null,
    actSel: new Set(),
    pickCat: 'basic',
    pickSearch: '',
    pickMode: null,
    editAdv: null,
    editMacro: null,
    version: null,
    versionError: null,
    connecting: false,
    busy: false,
    applyAgain: false,
    log: [],
    recording: null,
    socdDraft: null,
    act: { make: 10, brk: 10, linked: true },
  };
  const dev = new B.Boog75Device();
  dev.dryRun = !!S.settings.dryRun;

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function loadProfiles() {
    const list = store.get('profiles', null);
    const seen = new Set();
    S.profiles = (Array.isArray(list) ? list : []).filter((p) => p && typeof p === 'object').map((p) => {
      let id = typeof p.uid === 'string' && p.uid && !seen.has(p.uid) ? p.uid : uid();
      seen.add(id);
      return Object.assign(Pr.normalize(p), { uid: id });
    });
    if (!S.profiles.length) S.profiles = [Object.assign(Pr.defaultProfile('Default'), { uid: uid() })];
    S.activeUid = store.get('active', S.profiles[0].uid);
    if (!S.profiles.some((p) => p.uid === S.activeUid)) S.activeUid = S.profiles[0].uid;
  }
  const prof = () => S.profiles.find((p) => p.uid === S.activeUid);
  const saveProfiles = () => { store.set('profiles', S.profiles); store.set('active', S.activeUid); };
  const saveKnown = () => store.set('known', S.known);
  const saveSettings = () => store.set('settings', S.settings);
  const snapshot = (p) => { const { uid: _u, ...rest } = p; return JSON.stringify(rest); };
  const histFor = (id) => S.history[id] || (S.history[id] = { undo: [], redo: [] });

  function replaceActive(n) {
    const i = S.profiles.findIndex((p) => p.uid === S.activeUid);
    S.profiles[i] = n;
    saveProfiles();
  }

  // Change the active profile through fn (on a copy); everything is re-validated.
  function mutate(fn, opts) {
    const p = prof();
    const before = snapshot(p);
    const work = Pr.clone(p);
    fn(work);
    const n = Object.assign(Pr.normalize(work), { uid: p.uid });
    if (snapshot(n) === before) { render(); return; }
    const hs = histFor(p.uid);
    hs.undo.push(before);
    if (hs.undo.length > 200) hs.undo.shift();
    hs.redo = [];
    replaceActive(n);
    render();
    if (!(opts && opts.noAuto)) scheduleAutoApply();
  }
  function undoRedo(dir) {
    const hs = histFor(S.activeUid);
    const from = dir === 'undo' ? hs.undo : hs.redo;
    const to = dir === 'undo' ? hs.redo : hs.undo;
    if (!from.length || S.busy) return;
    stopRecording();
    cancelPick();
    to.push(snapshot(prof()));
    replaceActive(Object.assign(Pr.normalize(JSON.parse(from.pop())), { uid: S.activeUid }));
    S.socdDraft = null;
    if (!prof().macros.some((m) => m.id === S.editMacro)) S.editMacro = null;
    if (!prof().advanced.some((a) => a.id === S.editAdv)) S.editAdv = null;
    render();
    scheduleAutoApply();
  }

  // ------------------------------------------------------- applying
  const newProtocol = () => (S.version ? P.isNewProtocol(S.version.device) : true);
  const currentPlan = (full) => {
    try { return Pr.planSync(prof(), full ? null : S.known, newProtocol()); } catch (e) { return Object.assign([], { error: e }); }
  };
  let autoTimer = null;
  function scheduleAutoApply() {
    if (!S.settings.autoApply || !(dev.connected || dev.dryRun)) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => apply(false, true), 600);
  }

  async function apply(full, auto) {
    if (S.busy) { S.applyAgain = true; return; }
    if (S.recording) { toast('Stop the macro recording first.', 'warn'); return; }
    if (!dev.connected && !dev.dryRun) { if (!auto) toast('Connect the keyboard first.', 'warn'); return; }
    if (!dev.dryRun && !S.version) {
      toast('The firmware version is unknown, so writing is blocked to protect the keyboard. Unplug and replug it, then reconnect.', 'err');
      return;
    }
    const plan = currentPlan(full);
    if (plan.error) { toast('Profile error: ' + plan.error.message, 'err'); return; }
    if (!plan.length) { if (!auto) toast('Keyboard is already up to date.'); return; }
    const total = plan.reduce((n, s) => n + s.frames.length, 0);
    S.busy = true;
    renderHeader();
    if (total > 12) showProgress('Writing…', 0);
    let done = 0;
    try {
      for (const step of plan) {
        const label = (dev.dryRun ? '[dry run] ' : '') + step.label;
        $('progress-label').textContent = `${label}… (frame ${done + 1}/${total})`;
        await dev.send(step.frames, (i) => {
          $('progress-fill').style.width = ((100 * (done + i)) / total).toFixed(1) + '%';
          $('progress-label').textContent = `${label}… (frame ${Math.min(done + i + 1, total)}/${total})`;
        });
        done += step.frames.length;
        if (!dev.dryRun) { step.apply(S.known); saveKnown(); }
      }
      toast(dev.dryRun ? `Dry run: ${plural(total, 'frame')} logged, nothing sent.` : auto ? 'Saved to keyboard.' : `Saved to keyboard (${plural(plan.length, 'change')}).`);
    } catch (e) {
      toast(`Writing to the keyboard failed: ${e.message}. Steps that finished are saved. Reconnect and press Apply to send the rest.`, 'err');
      S.applyAgain = false;
    } finally {
      S.busy = false;
      hideProgress();
      render();
      if (S.applyAgain) { S.applyAgain = false; scheduleAutoApply(); }
    }
  }
  function showProgress(label, pct) {
    $('progress-label').textContent = label;
    $('progress-fill').style.width = pct + '%';
    $('progress').hidden = false;
  }
  const hideProgress = () => { $('progress').hidden = true; };

  // ---------------------------------------------------- connection
  dev.addEventListener('tx', (e) => logLine((e.detail.dry ? 'DRY ' : 'TX  ') + P.toHex(e.detail.data)));
  dev.addEventListener('rx', (e) => logLine('RX  ' + P.toHex(e.detail.data)));
  dev.addEventListener('stall', (e) => logLine('STALL (write never completed) ' + P.toHex(e.detail.data)));
  dev.addEventListener('connected', () => onConnected());
  dev.addEventListener('disconnected', (e) => {
    S.version = null;
    S.versionError = null;
    render();
    if (e.detail !== 'Disconnected') toast(e.detail, 'warn');
  });
  dev.addEventListener('available', () => { if (!dev.connected && !S.connecting) dev.autoConnect().catch(() => {}); });

  function logLine(s) {
    if (!S.settings.logEnabled) return;
    const t = new Date().toISOString().slice(11, 23);
    S.log.push(t + ' ' + s);
    if (S.log.length > 1000) S.log.splice(0, S.log.length - 1000);
    const el = $('log');
    if (el) { el.textContent = S.log.join('\n'); el.scrollTop = el.scrollHeight; }
  }

  async function onConnected() {
    render();
    try {
      S.version = await dev.readVersion();
      S.versionError = null;
    } catch (e) {
      S.version = null;
      S.versionError = e.message;
    }
    if (S.version) {
      try {
        S.known.rgb = Pr.normalize({ rgb: await dev.readRgb() }).rgb;
        saveKnown();
      } catch (e) { /* lighting simply counts as unknown */ }
      toast(`Connected, firmware ${S.version.label}.`);
    }
    render();
  }

  async function connectClicked() {
    if (dev.connected) { await dev.disconnect(); render(); return; }
    if (!B.webHidSupported()) { toast(window.isSecureContext ? 'This browser has no WebHID. Use Chrome, Chromium, Edge or Brave.' : 'WebHID needs HTTPS or localhost. See the banner at the top.', 'err'); return; }
    S.connecting = true;
    renderHeader();
    try {
      const ok = await dev.requestConnect();
      if (!ok) toast('No BOOG75 selected.', 'warn');
    } catch (e) {
      if (e.name === 'NotFoundError' || e.name === 'AbortError') { /* user cancelled */ }
      else if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || /open/i.test(e.message)) {
        toast('The browser could not open the keyboard. On Linux this usually means the udev rule is missing (see the Device tab).', 'err');
        S.tab = 'device';
      } else toast('Connection failed: ' + e.message, 'err');
    } finally {
      S.connecting = false;
      render();
    }
  }

  // ---------------------------------------------------------- theming
  function applyTheme() {
    const sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = S.settings.theme || sys;
  }

  // -------------------------------------------------------- rendering
  const TABS = [['keymap', 'Keymap'], ['actuation', 'Actuation'], ['advanced', 'Advanced keys'], ['macros', 'Macros'], ['lighting', 'Lighting'], ['device', 'Device']];

  function render() {
    renderHeader();
    renderBanners();
    renderTabs();
    renderKeyboard();
    renderPanel();
  }

  function renderHeader() {
    const connected = dev.connected;
    $('conn-dot').className = 'dot' + (S.busy || S.connecting ? ' busy' : connected ? ' on' : '');
    $('conn-status').textContent = connected ? `BOOG75 ${S.version ? S.version.label : ''}`.trim() : dev.dryRun ? 'Dry-run mode' : 'Not connected';
    $('btn-connect').textContent = connected ? 'Disconnect' : S.connecting ? 'Connecting…' : 'Connect';
    $('btn-connect').className = connected ? 'disconnect' : 'connect';
    $('btn-connect').disabled = S.connecting || S.busy;
    const sel = $('profile-select');
    sel.replaceChildren(...S.profiles.map((p) => h('option', { value: p.uid, selected: p.uid === S.activeUid }, p.name)));
    sel.disabled = S.busy || !!S.recording;
    $('btn-profile-menu').disabled = S.busy || !!S.recording;
    const hs = histFor(S.activeUid);
    $('btn-undo').disabled = !hs.undo.length || S.busy;
    $('btn-redo').disabled = !hs.redo.length || S.busy;
    $('auto-apply').checked = S.settings.autoApply;
    const plan = currentPlan();
    const n = plan.error ? 0 : plan.length;
    const btn = $('btn-apply');
    btn.textContent = S.busy ? 'Writing…' : n ? `Apply ${plural(n, 'change')}` : 'Up to date';
    btn.disabled = S.busy || !n || !(connected || dev.dryRun);
    btn.title = plan.error ? plan.error.message : n ? plan.map((s) => '• ' + s.label).join('\n') + (connected || dev.dryRun ? '' : '\n\nConnect the keyboard to apply.') : 'Keyboard matches this profile';
    $('footer').textContent = `BOOG75 Configurator ${APP_VERSION} · runs entirely in your browser · profiles are stored locally (export them for backups)`;
  }

  function renderBanners() {
    const out = [];
    const banner = (kind, ...kids) => out.push(h('div', { class: 'banner ' + kind }, ...kids));
    if (!window.isSecureContext) {
      banner('err', h('div', { class: 'grow' }, h('b', null, 'This page needs HTTPS. '),
        `Browsers only allow WebHID on secure pages. You opened ${location.origin}. `,
        'Serve it over HTTPS (for example behind a reverse proxy with a certificate) or open it via http://localhost (for example through an SSH tunnel).'));
    } else if (!B.webHidSupported()) {
      banner('err', h('div', { class: 'grow' }, h('b', null, 'WebHID is not available. '),
        'Open this page in Chrome, Chromium, Edge or Brave on a desktop computer. Firefox and Safari do not support WebHID.'));
    }
    if (dev.connected && S.versionError) {
      banner('err', h('div', { class: 'grow' }, `Couldn't read the firmware version (${S.versionError}). Writing is disabled until it's known. Unplug and replug the keyboard, then reconnect.`));
    }
    if (S.version && S.version.device > P.TESTED_MAX_VERSION) {
      banner('warn', h('div', { class: 'grow' }, `Firmware ${S.version.label} is newer than the newest version this tool was built against (V30). The basics should work, but check that advanced keys and macros behave as expected.`));
    }
    if (S.version && !P.isNewProtocol(S.version.device)) {
      banner('warn', h('div', { class: 'grow' }, `Firmware ${S.version.label} is older than V28. Keymap, layers, actuation/rapid trigger, toggle keys and lighting work. According to Meletrix's changelog, Dynamic Keystroke, Snappy Tappy and Rappy Snappy arrived in V29, and V30 fixed macros and F13–F24 remapping, so those may not work on this firmware.`));
    }
    if (dev.connected && !S.known.layers && !S.known.keys && !S.settings.firstRunDismissed) {
      banner('info',
        h('div', { class: 'grow' }, h('b', null, 'First connection. '),
          "The keyboard can't report its keymap or actuation settings (the official tool can't read them either; it only remembers what it last wrote). ",
          'To keep your current setup, export it from the official site (profile ⋯ → Export) and use ', h('b', null, 'Import'), ' here. ',
          'Otherwise press ', h('b', null, 'Apply'), ' to write this profile.'),
        h('button', { onclick: () => importFile() }, 'Import file…'),
        h('button', { onclick: () => { S.settings.firstRunDismissed = true; saveSettings(); render(); } }, 'Dismiss'));
    }
    $('banners').replaceChildren(...out);
  }

  function pendingSections() {
    const plan = currentPlan();
    const set = new Set();
    const layers = new Set();
    if (!plan.error) plan.forEach((s) => { set.add(s.section); if (s.section === 'keymap') layers.add(s.layer); });
    return { set, layers };
  }

  function switchTab(id) {
    if (S.tab === id) return;
    stopRecording();
    cancelPick(true);
    S.tab = id;
    render();
  }
  function renderTabs() {
    const pend = pendingSections().set;
    $('tabs').replaceChildren(...TABS.map(([id, name]) => h('button', {
      class: S.tab === id ? 'active' : '', 'data-tab': id,
      onclick: () => switchTab(id),
    }, name, pend.has(id) ? h('span', { class: 'pending-dot', title: 'Has changes not yet on the keyboard' }) : null)));
  }

  // ---------------------------------------------------------- keyboard
  let dragSelect = null;
  document.addEventListener('mouseup', () => { dragSelect = null; });

  function keyContent(i, p) {
    const base = p.layers[0][i];
    const adv = p.advanced.find((a) => a.key === i);
    const cls = [];
    let main, sub, badge;
    const baseLabel = () => (base.vk === VK.ADVANCED_KEY ? keyName(i) : base.vk === VK.MACRO ? 'Macro ' + (base.ext + 1) : base.vk === 0 ? '—' : K.label(base.vk));
    if (S.tab === 'keymap') {
      const k = p.layers[S.layer][i];
      if (k.vk === VK.MACRO) {
        const m = p.macros.find((x) => x.id === k.ext);
        main = 'Macro ' + (k.ext + 1); sub = m && m.name; cls.push('macro');
      } else if (k.vk === VK.ADVANCED_KEY) {
        main = keyName(i); badge = adv ? adv.type : 'ADV'; cls.push('adv');
      } else {
        main = k.vk === 0 ? '—' : K.label(k.vk);
        if (k.vk === 0) cls.push('empty');
      }
      const kl = S.known.layers && S.known.layers[S.layer];
      if (kl && !Pr.eq(kl[i], k)) cls.push('changed');
      if (S.selKey === i) cls.push('sel');
    } else if (S.tab === 'actuation') {
      const t = p.keys[i];
      main = baseLabel();
      sub = `${mm(t.make)}↓ ${mm(t.brk)}↑`;
      if (t.tgl) badge = 'TGL';
      if (S.known.keys && !Pr.eq(S.known.keys[i], t)) cls.push('changed');
      if (S.actSel.has(i)) cls.push('sel');
    } else {
      main = baseLabel();
      if (adv) { badge = adv.type; cls.push('adv'); }
      if (base.vk === VK.MACRO) cls.push('macro');
      if (S.tab === 'advanced' && adv && S.editAdv === adv.id) cls.push('sel');
    }
    if (S.tab === 'advanced' && p.socd && (p.socd.a === i || p.socd.b === i)) {
      cls.push('socd');
      badge = badge || (p.socd.type === 'RS' ? 'RS' : 'ST') + (p.socd.a === i ? '1' : '2');
    }
    if (S.pickMode) cls.push(S.pickMode.filter && !S.pickMode.filter(i) ? 'disabled' : 'picking');
    return { main, sub, badge, cls };
  }

  function renderKeyboard() {
    const p = prof();
    const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 54;
    $('keyboard').replaceChildren(...L.keys.map((k) => {
      const c = keyContent(k.idx, p);
      return h('div', {
        class: 'key ' + c.cls.join(' '),
        'data-idx': String(k.idx),
        style: { left: 12 + k.x * u + 2 + 'px', top: 12 + k.y * u + 2 + 'px', width: k.w * u - 4 + 'px', height: u - 4 + 'px' },
        title: `${keyName(k.idx)} (position ${k.idx})`,
        onmousedown: (e) => { if (e.button === 0) keyDown(k.idx, e); },
        onmouseenter: () => keyEnter(k.idx),
      }, h('div', null, c.main), c.sub ? h('div', { class: 'sub' }, c.sub) : null, c.badge ? h('div', { class: 'badge' }, c.badge) : null);
    }));
  }

  function keyDown(i, e) {
    if (S.pickMode) {
      if (S.pickMode.filter && !S.pickMode.filter(i)) return;
      const pm = S.pickMode;
      S.pickMode = null;
      render();
      pm.resolve(i);
      return;
    }
    if (S.tab === 'keymap') { S.selKey = i; render(); }
    else if (S.tab === 'actuation') {
      e.preventDefault();
      const add = !S.actSel.has(i);
      dragSelect = add ? 'add' : 'remove';
      add ? S.actSel.add(i) : S.actSel.delete(i);
      syncActuationEditor();
      render();
    } else if (S.tab === 'advanced') {
      const adv = prof().advanced.find((a) => a.key === i);
      if (adv) { S.editAdv = adv.id; render(); }
    }
  }
  function keyEnter(i) {
    if (S.tab !== 'actuation' || !dragSelect || S.pickMode) return;
    const had = S.actSel.has(i);
    if ((dragSelect === 'add') === had) return;
    dragSelect === 'add' ? S.actSel.add(i) : S.actSel.delete(i);
    render();
  }
  // Ask the user to click a key on the keyboard drawing. Resolves with the index, or null if cancelled.
  function pickKey(message, filter) {
    cancelPick(true);
    return new Promise((resolve) => {
      S.pickMode = { message, filter, resolve };
      render();
    });
  }
  function cancelPick(silent) {
    const pm = S.pickMode;
    if (!pm) return;
    S.pickMode = null;
    if (!silent) render();
    pm.resolve(null);
  }

  // Physical key press -> select that key (keymap/actuation tabs). The key
  // sends whatever is mapped on the keyboard, so look it up in what we
  // believe is on the keyboard, falling back to the factory layout.
  function idxForVk(vk) {
    const base = S.known.layers && S.known.layers[0];
    if (base) { const i = base.findIndex((k) => k.vk === vk); if (i >= 0) return i; }
    const d = L.defaultLayers[0].indexOf(vk);
    return d >= 0 ? d : undefined;
  }
  document.addEventListener('keydown', (e) => {
    if (S.recording || $('dialog').open) return;
    if (e.key === 'Escape') {
      if (!$('menu').hidden) { $('menu').hidden = true; return; }
      if (S.pickMode) { cancelPick(); return; }
    }
    const ae = document.activeElement;
    const tag = (ae && ae.tagName) || '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); apply(false); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo('undo'); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); undoRedo('redo'); }
      return;
    }
    if (S.tab !== 'keymap' && S.tab !== 'actuation') return;
    if (e.key === 'Tab' || e.altKey || e.repeat) return;
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    const vk = K.codeToVk[e.code];
    const idx = vk === undefined ? undefined : idxForVk(vk);
    if (idx === undefined) return;
    e.preventDefault();
    if (S.tab === 'keymap') S.selKey = idx;
    else { S.actSel.has(idx) ? S.actSel.delete(idx) : S.actSel.add(idx); syncActuationEditor(); }
    render();
  });

  // ------------------------------------------------------------ panel
  function renderPanel() {
    const panel = $('panel');
    const fn = { keymap: panelKeymap, actuation: panelActuation, advanced: panelAdvanced, macros: panelMacros, lighting: panelLighting, device: panelDevice }[S.tab];
    const scroll = Array.from(panel.querySelectorAll('.grid, .list, .steps-wrap')).map((el) => el.scrollTop);
    // Panels may return nested arrays and null placeholders; flatten them.
    const content = fn().flat(Infinity).filter((x) => x instanceof Node);
    if (S.pickMode) content.unshift(h('div', { class: 'banner info', style: { marginTop: 0, marginBottom: '12px' } },
      h('div', { class: 'grow' }, h('b', null, S.pickMode.message), ' (Esc to cancel)'),
      h('button', { onclick: () => cancelPick() }, 'Cancel')));
    panel.replaceChildren(...content);
    Array.from(panel.querySelectorAll('.grid, .list, .steps-wrap')).forEach((el, i) => { if (scroll[i]) el.scrollTop = scroll[i]; });
  }

  // Keycode picker grid.
  function renderPicker({ current, onPick, includeMacros }) {
    const p = prof();
    const wrap = h('div', { class: 'picker' });
    const draw = () => {
      const q = S.pickSearch.trim().toLowerCase();
      const cats = [...K.categories];
      if (includeMacros) cats.push({ id: 'macros', name: 'Macros' });
      const macroItem = (m) => ({ vk: VK.MACRO, ext: m.id, label: `Macro ${m.id + 1}\n${m.name}`, title: m.name || 'Macro ' + (m.id + 1) });
      let items;
      if (q) {
        items = K.entries.filter((e) => e.vk && (e.name.toLowerCase().includes(q) || oneLine(e.label).toLowerCase() === q))
          .map((e) => ({ vk: e.vk, ext: 0, label: e.label, title: e.name }));
        if (includeMacros) p.macros.filter((m) => ('macro ' + (m.id + 1) + ' ' + m.name).toLowerCase().includes(q)).forEach((m) => items.push(macroItem(m)));
      } else if (S.pickCat === 'macros' && includeMacros) {
        items = p.macros.map(macroItem);
      } else {
        const cat = cats.find((c) => c.id === S.pickCat && c.vks) || cats[0];
        items = cat.vks.map((vk) => ({ vk, ext: 0, label: vk === 0 ? 'None' : K.label(vk), title: K.name(vk) }));
      }
      const activeCat = q ? null : (cats.find((c) => c.id === S.pickCat && (c.vks || includeMacros)) || cats[0]).id;
      const search = h('input', { type: 'search', placeholder: 'Search keys…', value: S.pickSearch, style: { width: '220px' }, 'aria-label': 'Search keys' });
      search.addEventListener('input', () => {
        S.pickSearch = search.value;
        draw();
        const s = wrap.querySelector('input[type=search]');
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      });
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
      wrap.replaceChildren(
        h('div', { class: 'row' }, search),
        h('div', { class: 'cats' }, cats.map((c) => h('button', {
          class: 'small' + (activeCat === c.id ? ' active' : ''), type: 'button',
          onclick: () => { S.pickCat = c.id; S.pickSearch = ''; draw(); },
        }, c.name))),
        items.length
          ? h('div', { class: 'grid' }, items.map((it) => h('button', {
            type: 'button',
            class: 'kc' + (current && current.vk === it.vk && (it.vk !== VK.MACRO || current.ext === it.ext) ? ' current' : ''),
            title: it.title, onclick: () => onPick(it.vk, it.ext),
          }, it.label)))
          : h('p', { class: 'hint' }, activeCat === 'macros' ? 'No macros yet. Create one in the Macros tab.' : 'No matching keys.'));
    };
    draw();
    return wrap;
  }

  // ---------------------------------------------------------- keymap
  function panelKeymap() {
    const p = prof();
    const pendLayers = pendingSections().layers;
    const out = [];
    const copySel = h('select', { 'aria-label': 'Copy keys from layer' },
      h('option', { value: '' }, 'Copy from layer…'),
      L.layerNames.map((n, li) => (li === S.layer ? null : h('option', { value: String(li) }, n))));
    copySel.addEventListener('change', async () => {
      const src = Number(copySel.value);
      copySel.value = '';
      if (!Number.isInteger(src)) return;
      if (await confirmDlg('Copy layer', `Replace every key on the ${L.layerNames[S.layer]} layer with the keys from ${L.layerNames[src]}?`, 'Copy')) {
        const target = S.layer;
        mutate((pp) => {
          pp.layers[target] = Pr.clone(pp.layers[src]).map((k) => (k.vk === VK.ADVANCED_KEY ? { vk: 0, ext: 0 } : k));
          if (target === 0) pp.advanced = [];
        });
      }
    });
    out.push(h('div', { class: 'row' },
      h('div', { class: 'seg', role: 'tablist' }, L.layerNames.map((n, li) => h('button', {
        class: S.layer === li ? 'active' : '', onclick: () => { S.layer = li; render(); },
      }, n, pendLayers.has(li) ? h('span', { class: 'pending-dot' }) : null))),
      h('span', { class: 'hint' }, S.layer === 0 ? 'Normal layer.' : `Active while holding ${L.layerNames[S.layer]}.`),
      h('span', { class: 'spacer' }),
      copySel,
      h('button', {
        class: 'small', onclick: async () => {
          if (await confirmDlg('Reset layer', `Reset the ${L.layerNames[S.layer]} layer to factory keys?${S.layer === 0 && p.advanced.length ? ' This also removes all advanced keys.' : ''}`, 'Reset')) {
            const target = S.layer;
            mutate((pp) => {
              pp.layers[target] = L.defaultLayers[target].map((vk) => ({ vk, ext: 0 }));
              if (target === 0) pp.advanced = [];
            });
          }
        },
      }, 'Reset layer')));
    if (!p.layers[0].some((k) => k.vk === VK.FN)) {
      out.push(h('p', { class: 'warn-text' }, '⚠ No key on the base layer is set to Fn, so the Fn layers (and the factory Fn shortcuts) are unreachable.'));
    }
    if (S.selKey === null) {
      out.push(h('p', { class: 'muted' }, 'Click a key on the keyboard above, or press it on your keyboard, to change what it does.'));
      return out;
    }
    const i = S.selKey;
    const cur = p.layers[S.layer][i];
    const adv = S.layer === 0 && p.advanced.find((a) => a.key === i);
    out.push(h('h4', null, `Key "${keyName(i)}" on ${L.layerNames[S.layer]} layer`));
    out.push(h('div', { class: 'row' },
      h('span', null, 'Currently: ', h('b', null, cur.vk === VK.MACRO ? `Macro ${cur.ext + 1}` : cur.vk === VK.ADVANCED_KEY ? `${adv ? adv.type : 'Advanced'} key` : oneLine(K.name(cur.vk)))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'small', onclick: () => assignKey(i, { vk: L.defaultLayers[S.layer][i], ext: 0 }) }, 'Factory default'),
      h('button', { class: 'small', onclick: () => assignKey(i, { vk: 0, ext: 0 }) }, 'Disable key')));
    if (adv) out.push(h('p', { class: 'warn-text' }, `This key is a ${adv.type === 'DKS' ? 'Dynamic Keystroke' : 'Mod-Tap'} key. Picking a normal key removes that function.`));
    out.push(renderPicker({ current: cur, includeMacros: true, onPick: (vk, ext) => assignKey(i, { vk, ext }) }));
    return out;
  }
  async function assignKey(i, key) {
    const p = prof();
    const layer = S.layer;
    const cur = p.layers[layer][i];
    if (cur.vk === key.vk && cur.ext === key.ext) return;
    if (layer === 0 && cur.vk === VK.FN && key.vk !== VK.FN && p.layers[0].filter((k) => k.vk === VK.FN).length <= 1) {
      if (!(await confirmDlg('Remove the Fn key?', "This is the only Fn key. Without it you can't reach the Fn layers, including the factory media and RGB shortcuts. You can still fix it here later.", 'Remove Fn', true))) return;
    }
    mutate((pp) => {
      if (layer === 0) pp.advanced = pp.advanced.filter((a) => a.key !== i);
      pp.layers[layer][i] = key;
    });
  }

  // --------------------------------------------------------- actuation
  function syncActuationEditor() {
    const first = [...S.actSel][0];
    if (first !== undefined) {
      const k = prof().keys[first];
      S.act.make = k.make;
      S.act.brk = k.brk;
      S.act.linked = k.make === k.brk;
    }
  }
  function slider(label, value, min, max, step, fmt, onInput, onChange) {
    const out = h('output', null, fmt(value));
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
    input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); if (onInput) onInput(Number(input.value)); });
    input.addEventListener('change', () => onChange(Number(input.value)));
    return h('div', { class: 'slider' }, h('label', null, label), input, out);
  }
  const PRESET_WASD = [30, 31, 32, 33, 45, 46, 47, 48, 59, 72, 75];
  function panelActuation() {
    const p = prof();
    const sel = [...S.actSel];
    const setSel = (idxs) => { S.actSel = new Set(idxs); syncActuationEditor(); render(); };
    const out = [];
    out.push(h('div', { class: 'row' },
      h('b', null, sel.length ? `${plural(sel.length, 'key')} selected` : 'No keys selected'),
      h('button', { class: 'small', onclick: () => setSel(L.keys.map((k) => k.idx)) }, 'Select all'),
      h('button', { class: 'small', onclick: () => setSel(PRESET_WASD) }, 'Select WASD cluster'),
      h('button', { class: 'small', onclick: () => setSel(L.keys.map((k) => k.idx).filter((i) => !S.actSel.has(i))) }, 'Invert'),
      h('button', { class: 'small', disabled: !sel.length, onclick: () => setSel([]) }, 'Clear'),
      h('span', { class: 'hint' }, 'Click or drag across keys, or press them on your keyboard.')));
    out.push(h('h4', null, 'Travel settings'));
    out.push(h('p', { class: 'hint' }, 'The firmware stores two values per key (0.1–4.0 mm). ',
      h('b', null, 'Press stroke'), ' is the travel needed to register a press (and to re-trigger with Rapid Trigger). ',
      h('b', null, 'Release stroke'), ' is how far the key has to rise to release. Smaller is more sensitive. Factory default is 1.0 / 1.0 mm.'));
    let brkSlider;
    out.push(slider('Press stroke', S.act.make, 1, 40, 1, (v) => mm(v) + ' mm', (v) => {
      if (S.act.linked && brkSlider) { brkSlider.querySelector('input').value = v; brkSlider.querySelector('output').textContent = mm(v) + ' mm'; }
    }, (v) => { S.act.make = v; if (S.act.linked) S.act.brk = v; render(); }));
    brkSlider = slider('Release stroke', S.act.brk, 1, 40, 1, (v) => mm(v) + ' mm', null, (v) => { S.act.brk = v; if (v !== S.act.make) S.act.linked = false; render(); });
    out.push(brkSlider);
    out.push(h('div', { class: 'row', style: { marginTop: '8px' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.act.linked, onchange: (e) => { S.act.linked = e.target.checked; if (S.act.linked) S.act.brk = S.act.make; render(); } }), 'Keep release equal to press'),
      h('span', { class: 'spacer' }),
      h('span', { class: 'hint' }, 'Presets:'),
      [['Default', 10, 10], ['Typing', 15, 15], ['Gaming', 4, 3], ['Competitive', 2, 1]].map(([n, a, b]) => h('button', {
        class: 'small', onclick: () => { S.act.make = a; S.act.brk = b; S.act.linked = a === b; render(); },
      }, `${n} (${mm(a)}/${mm(b)})`))));
    out.push(h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', {
        class: 'accent', disabled: !sel.length,
        onclick: () => mutate((pp) => sel.forEach((i) => { pp.keys[i].make = S.act.make; pp.keys[i].brk = S.act.brk; })),
      }, `Set ${mm(S.act.make)} / ${mm(S.act.brk)} mm on selected`),
      h('button', { disabled: !sel.length, onclick: () => mutate((pp) => sel.forEach((i) => { pp.keys[i] = { make: 10, brk: 10, tgl: false }; })) }, 'Reset selected')));
    out.push(h('h4', null, 'Toggle (TGL)'));
    out.push(h('p', { class: 'hint' }, 'A toggle key latches: tap once to hold it down, tap again to release it. Handy for crouch or walk keys.'));
    out.push(h('div', { class: 'row' },
      h('button', { disabled: !sel.length || sel.every((i) => p.keys[i].tgl), onclick: () => mutate((pp) => sel.forEach((i) => (pp.keys[i].tgl = true))) }, 'Make selected toggle keys'),
      h('button', { disabled: !sel.some((i) => p.keys[i].tgl), onclick: () => mutate((pp) => sel.forEach((i) => (pp.keys[i].tgl = false))) }, 'Make selected normal')));
    return out;
  }

  // ---------------------------------------------------------- advanced
  const STAGE_NAMES = ['① Press past start point', '② Bottom out', '③ Release from bottom', '④ Release past end point'];
  const freeId = (list, max) => { for (let i = 0; i < max; i++) if (!list.some((x) => x.id === i)) return i; return -1; };
  const usableVk = (vk) => vk && vk !== VK.MACRO && vk !== VK.ADVANCED_KEY;

  async function addAdvanced(type) {
    if (freeId(prof().advanced, P.MAX_ADVANCED) < 0) { toast(`At most ${P.MAX_ADVANCED} advanced keys.`, 'warn'); return; }
    const idx = await pickKey(`Click the key that should become a ${type === 'DKS' ? 'Dynamic Keystroke' : 'Mod-Tap'} key`,
      (i) => i !== L.FN_KEY_INDEX && !prof().advanced.some((a) => a.key === i));
    if (idx === null || idx === undefined) return;
    const p = prof();
    const id = freeId(p.advanced, P.MAX_ADVANCED);
    if (id < 0) return;
    const origVk = p.layers[0][idx].vk;
    const entry = type === 'DKS'
      ? { id, type, key: idx, first: 16, last: 16, origVk, bindings: [0, 1, 2, 3].map(() => Pr.emptyDksBinding()) }
      : { id, type, key: idx, holdVk: 0, tapVk: usableVk(origVk) ? origVk : 0, holdMs: 200, origVk };
    if (type === 'DKS' && usableVk(origVk)) {
      entry.bindings[0].vk = origVk;
      entry.bindings[0].stages[0] = { on: true, span: 3 };
    }
    S.editAdv = id;
    mutate((pp) => pp.advanced.push(entry));
  }
  function removeAdvanced(a) {
    if (S.editAdv === a.id) S.editAdv = null;
    mutate((pp) => {
      pp.advanced = pp.advanced.filter((x) => x.id !== a.id);
      pp.layers[0][a.key] = { vk: usableVk(a.origVk) ? a.origVk : L.defaultLayers[0][a.key], ext: 0 };
    });
  }
  const editAdvField = (id, fn) => mutate((pp) => { const a = pp.advanced.find((x) => x.id === id); if (a) fn(a); });

  function keyButton(vk, onChange, placeholder, title) {
    return h('button', {
      class: 'small', style: { minWidth: '90px' }, title: title || 'Choose key',
      onclick: async () => { const r = await pickKeycodeDlg(title || 'Choose key', { vk, ext: 0 }, { allowClear: true }); if (r) onChange(r.vk); },
    }, vk ? oneLine(K.label(vk)) : placeholder || 'Choose…');
  }

  function panelAdvanced() {
    const p = prof();
    const left = h('div', null,
      h('h3', null, 'Advanced keys'),
      h('div', { class: 'row' },
        h('button', { onclick: () => addAdvanced('DKS') }, '+ Dynamic Keystroke'),
        h('button', { onclick: () => addAdvanced('MT') }, '+ Mod-Tap')),
      h('p', { class: 'hint' }, `${p.advanced.length}/${P.MAX_ADVANCED} used. Advanced keys live on the base layer. Toggle keys are set in the Actuation tab.`),
      S.version && S.version.device < 0x29 ? h('p', { class: 'warn-text' }, `⚠ Your firmware (${S.version.label}) probably predates Dynamic Keystroke and SOCD support (added in V29).`) : null,
      h('div', { class: 'list' }, p.advanced.length ? p.advanced.map((a) => h('div', {
        class: 'item' + (S.editAdv === a.id ? ' active' : ''), onclick: () => { S.editAdv = a.id; render(); },
      }, h('span', { class: 'tag ' + a.type.toLowerCase() }, a.type),
      h('span', { class: 'grow' }, keyName(a.key)),
      h('button', { class: 'small danger', title: 'Remove', onclick: (e) => { e.stopPropagation(); removeAdvanced(a); } }, '✕'))) : h('p', { class: 'muted' }, 'None yet.')),
      h('h3', { style: { marginTop: '20px' } }, 'SOCD'),
      socdEditor());
    const right = h('div', null);
    const a = p.advanced.find((x) => x.id === S.editAdv);
    if (!a) {
      right.append(h('p', { class: 'muted' }, 'Pick an advanced key from the list, or click it on the keyboard, to edit it.'),
        h('p', { class: 'hint' }, h('b', null, 'Dynamic Keystroke (DKS): '), 'up to 4 actions on one key, triggered at different points of the press.',
          h('br'), h('b', null, 'Mod-Tap: '), 'tap for one key, hold for another.'));
    } else if (a.type === 'DKS') {
      right.append(h('h3', null, `Dynamic Keystroke on "${keyName(a.key)}"`),
        h('p', { class: 'hint' }, 'For each binding, choose at which stages it fires. "Tap" sends a short press at that stage; "Hold → n" keeps it pressed until stage n.'));
      right.append(h('table', { class: 'dks-table' },
        h('tr', null, h('th', null, 'Binding'), STAGE_NAMES.map((n) => h('th', null, n))),
        a.bindings.map((b, bi) => h('tr', null,
          h('td', null, keyButton(b.vk, (vk) => editAdvField(a.id, (x) => { x.bindings[bi].vk = vk; }), 'Key ' + (bi + 1), `Binding ${bi + 1}`)),
          b.stages.map((st, si) => {
            const opts = [h('option', { value: 'off', selected: !st.on }, '—'), h('option', { value: '0', selected: st.on && st.span === 0 }, 'Tap')];
            for (let sp = 1; sp <= 3 - si; sp++) opts.push(h('option', { value: String(sp), selected: st.on && st.span === sp }, `Hold → ${['②', '③', '④'][si + sp - 1]}`));
            return h('td', null, h('select', {
              disabled: !b.vk, 'aria-label': `Binding ${bi + 1}, ${STAGE_NAMES[si]}`,
              onchange: (e) => editAdvField(a.id, (x) => { x.bindings[bi].stages[si] = e.target.value === 'off' ? { on: false, span: 0 } : { on: true, span: Number(e.target.value) }; }),
            }, opts));
          })))),
        h('h4', null, 'Actuation points'),
        slider('Start point (①)', a.first, 1, 35, 1, (v) => mm(v) + ' mm', null, (v) => editAdvField(a.id, (x) => { x.first = v; })),
        slider('End point (④)', a.last, 1, 35, 1, (v) => mm(v) + ' mm', null, (v) => editAdvField(a.id, (x) => { x.last = v; })),
        h('p', { class: 'hint' }, 'Bottom-out (② / ③) is fixed at 3.6 mm by the firmware.'));
      if (!a.bindings.some((b) => b.vk && b.stages.some((s) => s.on))) right.append(h('p', { class: 'warn-text' }, '⚠ No binding fires at any stage yet, so this key currently does nothing.'));
    } else {
      right.append(h('h3', null, `Mod-Tap on "${keyName(a.key)}"`),
        h('div', { class: 'row' }, h('span', { style: { width: '120px' } }, 'Tap sends'), keyButton(a.tapVk, (vk) => editAdvField(a.id, (x) => { x.tapVk = vk; }), null, 'Tap key')),
        h('div', { class: 'row' }, h('span', { style: { width: '120px' } }, 'Hold sends'), keyButton(a.holdVk, (vk) => editAdvField(a.id, (x) => { x.holdVk = vk; }), null, 'Hold key')),
        h('h4', null, 'Timing'),
        slider('Hold after', a.holdMs, 10, 1000, 10, (v) => v + ' ms', null, (v) => editAdvField(a.id, (x) => { x.holdMs = v; })),
        h('p', { class: 'hint' }, 'Holding longer than this counts as "hold". Default 200 ms. This key uses its own press/release strokes from the Actuation tab.'));
      if (!a.holdVk && !a.tapVk) right.append(h('p', { class: 'warn-text' }, '⚠ Choose at least one key. Until then nothing is sent for this Mod-Tap.'));
    }
    if (a) right.append(h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'danger', onclick: () => removeAdvanced(a) }, 'Remove this advanced key')));
    return [h('div', { class: 'cols' }, left, right)];
  }

  function socdEditor() {
    const p = prof();
    if (!S.socdDraft) S.socdDraft = p.socd ? Pr.clone(p.socd) : { type: null, a: null, b: null, priority: 0, fullPressAlt: true };
    const d = S.socdDraft;
    const wrap = h('div', null);
    const commit = () => {
      if (!d.type) mutate((pp) => { pp.socd = null; });
      else if (Number.isInteger(d.a) && Number.isInteger(d.b) && d.a !== d.b) mutate((pp) => { pp.socd = Pr.clone(d); });
      else if (p.socd) mutate((pp) => { pp.socd = null; });
      else render();
    };
    wrap.append(
      h('p', { class: 'hint' }, 'Watches two opposing keys (such as A/D). Only one pair can be active.'),
      h('div', { class: 'seg' }, [[null, 'Off'], ['RS', 'Rappy Snappy'], ['ST', 'Snappy Tappy']].map(([t, n]) => h('button', {
        class: d.type === t ? 'active' : '', onclick: () => { d.type = t; commit(); },
      }, n))));
    if (d.type) {
      const pickBtn = (which) => h('button', {
        class: 'small', 'data-socd': which, onclick: async () => {
          const i = await pickKey(`Click key ${which === 'a' ? 1 : 2} for ${d.type === 'RS' ? 'Rappy Snappy' : 'Snappy Tappy'}`, (k) => k !== (which === 'a' ? d.b : d.a));
          if (i !== null && i !== undefined) { d[which] = i; commit(); }
        },
      }, Number.isInteger(d[which]) ? keyName(d[which]) : 'Pick…');
      wrap.append(
        h('p', { class: 'hint' }, d.type === 'RS' ? 'Whichever of the two keys is pressed further wins.' : 'Decides what happens when both keys are pressed.'),
        h('div', { class: 'row' }, 'Key 1', pickBtn('a'), 'Key 2', pickBtn('b')));
      if (d.type === 'ST') {
        wrap.append(h('div', { style: { marginTop: '8px' } }, ['Last input wins', 'Key 1 always wins', 'Key 2 always wins', 'Neutral (neither)'].map((n, i) => h('div', null,
          h('label', { class: 'check' }, h('input', { type: 'radio', name: 'socdp', checked: d.priority === i, onchange: () => { d.priority = i; commit(); } }), n)))),
        h('label', { class: 'check', style: { marginTop: '6px' } }, h('input', { type: 'checkbox', checked: d.fullPressAlt, onchange: (e) => { d.fullPressAlt = e.target.checked; commit(); } }), 'Both fully pressed → send both'));
      }
      if (!(Number.isInteger(d.a) && Number.isInteger(d.b))) wrap.append(h('p', { class: 'warn-text' }, 'Pick both keys to turn this on.'));
    }
    return wrap;
  }

  // ------------------------------------------------------------ macros
  const editMacroField = (id, fn) => mutate((pp) => { const m = pp.macros.find((x) => x.id === id); if (m) fn(m); });
  function stuckKeys(m) {
    const down = new Set();
    m.steps.forEach((s) => (s.down ? down.add(s.vk) : down.delete(s.vk)));
    return [...down];
  }
  function stopRecording() { if (S.recording) S.recording.stop(); }

  function startRecording(m) {
    const room = P.MAX_MACRO_STEPS - m.steps.length;
    const steps = [];
    let last = performance.now();
    const onKey = (e) => {
      if (e.type === 'keydown' && e.repeat) { e.preventDefault(); return; }
      const vk = K.codeToVk[e.code];
      e.preventDefault();
      e.stopPropagation();
      if (vk === undefined) return;
      const now = performance.now();
      if (steps.length) steps[steps.length - 1].delay = Math.min(1000, 5 * Math.round((now - last) / 5));
      last = now;
      steps.push({ vk, down: e.type === 'keydown', delay: 10 });
      const el = $('rec-count');
      if (el) el.textContent = `${plural(steps.length, 'event')} recorded`;
      if (steps.length >= room) { stop(); toast(`A macro can hold at most ${P.MAX_MACRO_STEPS} steps; recording stopped.`, 'warn'); }
    };
    const stop = () => {
      if (S.recording !== rec) return;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      S.recording = null;
      if (steps.length && S.activeUid === rec.uid) editMacroField(m.id, (x) => { x.steps = x.steps.concat(steps).slice(0, P.MAX_MACRO_STEPS); });
      else render();
    };
    const rec = { id: m.id, uid: S.activeUid, stop };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    S.recording = rec;
    render();
  }

  function panelMacros() {
    const p = prof();
    const left = h('div', null,
      h('div', { class: 'row' }, h('h3', { style: { margin: 0 } }, 'Macros'), h('span', { class: 'spacer' }),
        h('button', {
          class: 'small', disabled: !!S.recording,
          onclick: () => {
            const id = freeId(p.macros, P.MAX_MACROS);
            if (id < 0) { toast(`At most ${P.MAX_MACROS} macros.`, 'warn'); return; }
            S.editMacro = id;
            mutate((pp) => pp.macros.push({ id, name: 'Macro ' + (id + 1), mode: 'count', count: 1, steps: [] }));
          },
        }, '+ New')),
      h('div', { class: 'list', style: { marginTop: '8px' } }, p.macros.length ? p.macros.map((m) => h('div', {
        class: 'item' + (S.editMacro === m.id ? ' active' : ''), onclick: () => { if (!S.recording) { S.editMacro = m.id; render(); } },
      }, h('span', { class: 'muted' }, '#' + (m.id + 1)), h('span', { class: 'grow' }, m.name || '(unnamed)'), h('span', { class: 'hint' }, plural(m.steps.length, 'step')))) : h('p', { class: 'muted' }, 'No macros yet.')),
      h('p', { class: 'hint' }, `${p.macros.length}/${P.MAX_MACROS} used. To use a macro, assign it to a key under Keymap → Macros.`));
    const right = h('div', null);
    const m = p.macros.find((x) => x.id === S.editMacro);
    if (!m) {
      right.append(h('p', { class: 'muted' }, 'Select or create a macro.'));
      return [h('div', { class: 'cols' }, left, right)];
    }
    const recordingThis = S.recording && S.recording.id === m.id;
    const nameInput = h('input', { type: 'text', value: m.name, maxLength: 10, style: { width: '160px' }, 'aria-label': 'Macro name' });
    nameInput.addEventListener('change', () => editMacroField(m.id, (x) => { x.name = nameInput.value; }));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
    const countInput = h('input', { type: 'number', min: 1, max: 253, value: m.count, style: { width: '70px' }, 'aria-label': 'Repeat count' });
    countInput.addEventListener('change', () => editMacroField(m.id, (x) => { x.count = Number(countInput.value); }));
    const used = p.layers.some((l) => l.some((k) => k.vk === VK.MACRO && k.ext === m.id));
    right.append(
      h('div', { class: 'row' }, h('label', null, 'Name'), nameInput, h('span', { class: 'hint' }, 'max 10 characters'), h('span', { class: 'spacer' }),
        h('button', {
          class: 'small', disabled: !!S.recording, title: 'Duplicate macro',
          onclick: () => {
            const id = freeId(p.macros, P.MAX_MACROS);
            if (id < 0) { toast(`At most ${P.MAX_MACROS} macros.`, 'warn'); return; }
            S.editMacro = id;
            mutate((pp) => pp.macros.push(Object.assign(Pr.clone(m), { id, name: (m.name + ' 2').slice(0, 10) })));
          },
        }, 'Duplicate'),
        h('button', {
          class: 'small danger', disabled: !!S.recording,
          onclick: async () => {
            if (await confirmDlg('Delete macro', `Delete "${m.name || 'macro ' + (m.id + 1)}"?${used ? ' Keys using it go back to their factory function.' : ''}`, 'Delete', true)) {
              S.editMacro = null;
              mutate((pp) => { pp.macros = pp.macros.filter((x) => x.id !== m.id); });
            }
          },
        }, 'Delete')),
      h('div', { class: 'row' }, h('label', null, 'Run mode'),
        h('select', { 'aria-label': 'Run mode', onchange: (e) => editMacroField(m.id, (x) => { x.mode = e.target.value; }) },
          h('option', { value: 'count', selected: m.mode === 'count' }, 'Play a number of times'),
          h('option', { value: 'hold', selected: m.mode === 'hold' }, 'Repeat while held'),
          h('option', { value: 'toggle', selected: m.mode === 'toggle' }, 'Tap to start / tap to stop')),
        m.mode === 'count' ? [countInput, h('span', { class: 'hint' }, 'times')] : null),
      used ? null : h('p', { class: 'hint' }, 'Not assigned to any key yet.'),
      h('h4', null, `Steps (${m.steps.length}/${P.MAX_MACRO_STEPS})`),
      h('div', { class: 'row' },
        recordingThis
          ? [h('button', { class: 'accent', onclick: () => stopRecording() }, '■ Stop recording'), h('span', { id: 'rec-count', class: 'warn-text' }, 'Recording… type on your keyboard')]
          : h('button', { disabled: !!S.recording || m.steps.length >= P.MAX_MACRO_STEPS, onclick: () => startRecording(m) }, '● Record'),
        h('button', {
          disabled: !!S.recording || m.steps.length > P.MAX_MACRO_STEPS - 2,
          onclick: async () => { const r = await pickKeycodeDlg('Add key tap'); if (r && r.vk) editMacroField(m.id, (x) => { x.steps.push({ vk: r.vk, down: true, delay: 10 }, { vk: r.vk, down: false, delay: 10 }); }); },
        }, '+ Key tap'),
        h('button', { disabled: !!S.recording || !m.steps.length, onclick: () => editMacroField(m.id, (x) => { x.steps = []; }) }, 'Clear steps')));
    const rows = m.steps.map((s, si) => {
      const delay = h('input', { type: 'number', min: 0, max: 1000, step: 5, value: s.delay, 'aria-label': `Step ${si + 1} delay` });
      delay.addEventListener('change', () => editMacroField(m.id, (x) => { x.steps[si].delay = Math.max(0, Math.min(1000, 5 * Math.round(Number(delay.value) / 5) || 0)); }));
      const move = (to) => editMacroField(m.id, (x) => { x.steps.splice(to, 0, x.steps.splice(si, 1)[0]); });
      return h('tr', null,
        h('td', { class: 'muted' }, si + 1),
        h('td', null, keyButton(s.vk, (vk) => { if (vk) editMacroField(m.id, (x) => { x.steps[si].vk = vk; }); }, null, `Step ${si + 1} key`)),
        h('td', null, h('select', { 'aria-label': `Step ${si + 1} action`, onchange: (e) => editMacroField(m.id, (x) => { x.steps[si].down = e.target.value === 'down'; }) },
          h('option', { value: 'down', selected: s.down }, '↓ press'), h('option', { value: 'up', selected: !s.down }, '↑ release'))),
        h('td', null, delay, ' ms'),
        h('td', null,
          h('button', { class: 'small', title: 'Move up', disabled: si === 0 || !!S.recording, onclick: () => move(si - 1) }, '↑'), ' ',
          h('button', { class: 'small', title: 'Move down', disabled: si === m.steps.length - 1 || !!S.recording, onclick: () => move(si + 1) }, '↓'), ' ',
          h('button', { class: 'small danger', title: 'Delete step', disabled: !!S.recording, onclick: () => editMacroField(m.id, (x) => { x.steps.splice(si, 1); }) }, '✕')));
    });
    right.append(m.steps.length
      ? h('div', { class: 'steps-wrap' }, h('table', { class: 'steps' }, h('tr', null, h('th', null, '#'), h('th', null, 'Key'), h('th', null, 'Action'), h('th', null, 'Delay after'), h('th', null, '')), rows))
      : h('p', { class: 'muted' }, 'No steps yet. Record or add key taps.'));
    const stuck = stuckKeys(m);
    if (stuck.length) right.append(h('p', { class: 'warn-text' }, `⚠ Pressed but never released: ${stuck.map((vk) => oneLine(K.label(vk))).join(', ')}. That key would stay held.`));
    return [h('div', { class: 'cols' }, left, right)];
  }

  // ----------------------------------------------------------- lighting
  const EFFECTS = ['Spectrum cycle', 'Static', 'Left→right wave', 'Breathing', 'Snake', 'Magnetic', 'Rotate', 'Center wave', 'Fountain'];
  const EXTRA_EFFECTS = ['Laser', 'Cross wave', 'Traffic', 'Ripple', 'Dance', 'Random fountain', 'Love'];
  function panelLighting() {
    const r = prof().rgb;
    const setRgb = (fn) => mutate((pp) => fn(pp.rgb));
    const effectBtn = (n, i) => h('button', { class: r.effect === i ? 'active' : '', onclick: () => setRgb((x) => { x.effect = i; }) }, n);
    const showExtra = S.settings.extraEffects || r.effect >= EFFECTS.length;
    return [
      h('div', { class: 'row' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!r.on, onchange: (e) => setRgb((x) => { x.on = e.target.checked ? 1 : 0; }) }), h('b', null, 'Lighting on')),
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'small', disabled: !dev.connected || S.busy,
          onclick: async () => {
            try {
              const k = Pr.normalize({ rgb: await dev.readRgb() }).rgb;
              S.known.rgb = k;
              saveKnown();
              mutate((pp) => { pp.rgb = k; }, { noAuto: true });
              toast('Loaded lighting from the keyboard.');
            } catch (e) { toast('Could not read lighting: ' + e.message, 'err'); }
          },
        }, 'Load from keyboard')),
      h('h4', null, 'Effect'),
      h('div', { class: 'effects' }, EFFECTS.map(effectBtn)),
      showExtra
        ? [h('p', { class: 'hint' }, 'More effects defined by the firmware but not offered by the official tool. They may not exist on every firmware version.'),
          h('div', { class: 'effects' }, EXTRA_EFFECTS.map((n, i) => effectBtn(n, EFFECTS.length + i)))]
        : h('button', { class: 'small', style: { marginTop: '8px' }, onclick: () => { S.settings.extraEffects = true; saveSettings(); render(); } }, 'Show more effects'),
      h('h4', null, 'Brightness & speed'),
      slider('Brightness', r.brightness, 0, 9, 1, (v) => (v === 0 ? 'Off' : String(v)), null, (v) => setRgb((x) => { x.brightness = v; })),
      slider('Speed', r.speed, 0, 3, 1, (v) => ['Slowest', 'Slow', 'Fast', 'Fastest'][v], null, (v) => setRgb((x) => { x.speed = v; })),
      h('h4', null, 'Colour'),
      h('p', { class: 'hint' }, 'Pick the active colour slot. Click a swatch to edit its colour.'),
      h('div', { class: 'swatches' }, r.colors.map((c, i) => {
        const input = h('input', { type: 'color', value: c, 'aria-label': i === 0 ? 'Default colour' : 'Colour slot ' + i });
        input.addEventListener('change', () => setRgb((x) => { x.colors[i] = input.value.toLowerCase(); x.colorIndex = i; }));
        return h('div', { class: 'swatch' + (r.colorIndex === i ? ' active' : ''), 'data-slot': String(i), onclick: (e) => { if (e.target !== input && r.colorIndex !== i) setRgb((x) => { x.colorIndex = i; }); } },
          input, h('span', { class: 'hint' }, i === 0 ? 'Default' : 'Slot ' + i));
      })),
    ];
  }

  // ------------------------------------------------------------- device
  async function readMacrosFromKeyboard() {
    if (!dev.connected || S.busy) return;
    S.busy = true;
    renderHeader();
    showProgress('Reading macros…', 0);
    const found = [];
    let failures = 0;
    let error = null;
    try {
      for (let id = 0; id < P.MAX_MACROS; id++) {
        $('progress-label').textContent = `Reading macro ${id + 1} of ${P.MAX_MACROS}…`;
        $('progress-fill').style.width = ((100 * id) / P.MAX_MACROS).toFixed(1) + '%';
        try {
          const m = await dev.readMacro(id);
          if (m && !m.corrupt) found.push(m);
          else if (m && m.corrupt) failures++;
        } catch (e) {
          if (!dev.connected) throw e;
          failures++;
          if (id === 1 && failures === 2) throw new Error('the keyboard did not answer macro requests');
        }
      }
    } catch (e) {
      error = e;
    } finally {
      S.busy = false;
      hideProgress();
      render();
    }
    if (error) { toast('Reading macros failed: ' + error.message, 'err'); return; }
    const macros = Pr.normalize({ macros: found }).macros;
    if (failures === 0) { S.known.macros = macros; saveKnown(); }
    const ok = await confirmDlg('Macros read', `Found ${plural(macros.length, 'macro')} on the keyboard${failures ? ` (${plural(failures, 'slot')} unreadable)` : ''}. Replace this profile's macros with them? Keys that use a macro that isn't on the keyboard go back to their factory function.`, 'Replace');
    if (ok) mutate((pp) => { pp.macros = macros; }, { noAuto: true });
  }

  function panelDevice() {
    const v = S.version;
    const plan = currentPlan();
    const udev = 'KERNEL=="hidraw*", ATTRS{idVendor}=="36b5", ATTRS{idProduct}=="2f8f", MODE="0660", TAG+="uaccess"';
    const canWrite = (dev.connected || dev.dryRun) && !S.busy;
    return [
      h('div', { class: 'cols' },
        h('div', null,
          h('h3', null, 'Keyboard'),
          h('dl', { class: 'info' },
            h('dt', null, 'Status'), h('dd', null, dev.connected ? h('span', { class: 'ok-text' }, 'Connected') : 'Not connected'),
            h('dt', null, 'Firmware'), h('dd', null, v ? v.label : '—'),
            h('dt', null, 'Hall sensor MCU'), h('dd', null, v ? v.hallLabel : '—'),
            h('dt', null, 'Driver protocol'), h('dd', null, v ? `${v.protocolLabel} (${P.isNewProtocol(v.device) ? 'current' : 'legacy'} format)` : '—'),
            h('dt', null, 'Pending changes'), h('dd', { id: 'pending-list' }, plan.error ? h('span', { class: 'err-text' }, plan.error.message) : plan.length ? plan.map((s) => h('div', null, '• ' + s.label)) : 'None'))),
        h('div', null,
          h('h3', null, 'Sync'),
          h('div', { class: 'row' },
            h('button', { disabled: !canWrite, onclick: async () => { if (await confirmDlg('Write everything', 'Send the complete profile (all layers, actuation, lighting, advanced keys, SOCD and macros) to the keyboard?', 'Write all')) apply(true); } }, 'Write entire profile'),
            h('button', { disabled: !dev.connected || S.busy, onclick: readMacrosFromKeyboard }, 'Read macros from keyboard'),
            h('button', { disabled: S.busy, onclick: async () => { if (await confirmDlg('Forget keyboard state', 'Treat everything on the keyboard as unknown, so the next Apply writes the full profile? Use this if you changed settings with another tool.', 'Forget')) { S.known = {}; saveKnown(); render(); } } }, 'Forget keyboard state')),
          h('p', { class: 'hint' }, 'The tool remembers what it last wrote, so Apply only sends what changed. If you change settings with the official site or on another computer, use "Forget keyboard state" or "Write entire profile".'),
          h('h3', { style: { marginTop: '18px' } }, 'Options'),
          h('div', null, h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'opt-dry', checked: S.settings.dryRun, onchange: (e) => { S.settings.dryRun = dev.dryRun = e.target.checked; if (e.target.checked) S.settings.logEnabled = true; saveSettings(); render(); } }), 'Dry run: log frames instead of sending them')),
          h('div', null, h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'opt-log', checked: S.settings.logEnabled, onchange: (e) => { S.settings.logEnabled = e.target.checked; saveSettings(); render(); } }), 'Record USB protocol log')))),
      S.settings.logEnabled ? [
        h('div', { class: 'row', style: { marginTop: '14px' } }, h('h4', { style: { margin: 0 } }, 'Protocol log'), h('span', { class: 'spacer' }),
          h('button', { class: 'small', disabled: !S.log.length, onclick: () => { navigator.clipboard.writeText(S.log.join('\n')).then(() => toast('Log copied.'), () => toast('Copy failed; select the text instead.', 'warn')); } }, 'Copy'),
          h('button', { class: 'small', onclick: () => { S.log = []; render(); } }, 'Clear')),
        h('pre', { class: 'log', id: 'log' }, S.log.join('\n') || '(empty)')] : null,
      h('h3', { style: { marginTop: '18px' } }, 'Keyboard shortcuts'),
      h('p', { class: 'hint' }, h('kbd', null, 'Ctrl+S'), ' apply  ·  ', h('kbd', null, 'Ctrl+Z'), ' undo  ·  ', h('kbd', null, 'Ctrl+Shift+Z'), ' / ', h('kbd', null, 'Ctrl+Y'), ' redo  ·  ',
        h('kbd', null, 'Esc'), ' cancel picking  ·  in Keymap and Actuation, press a key on the keyboard to select it'),
      h('h3', { style: { marginTop: '18px' } }, 'Linux setup (one time)'),
      h('p', { class: 'hint' }, "Browsers need read/write access to the keyboard's hidraw device. If Connect fails or the keyboard is missing from the list, install this udev rule and replug the keyboard:"),
      h('pre', { class: 'code' }, `echo '${udev}' | sudo tee /etc/udev/rules.d/70-boog75.rules\nsudo udevadm control --reload-rules && sudo udevadm trigger`),
      h('p', { class: 'hint' }, 'Normal typing is unaffected; this only gives your logged-in user access to the configuration interface.'),
    ];
  }

  // ---------------------------------------------------------- profiles
  function showProfileMenu() {
    const menu = $('menu');
    if (!menu.hidden) { menu.hidden = true; return; }
    const btn = $('btn-profile-menu').getBoundingClientRect();
    const item = (label, fn, cls) => h('button', { class: cls || '', role: 'menuitem', onclick: () => { menu.hidden = true; fn(); } }, label);
    menu.replaceChildren(
      item('New profile…', async () => { const n = await promptDlg('New profile name', 'Profile ' + (S.profiles.length + 1)); if (n) addProfile(Pr.defaultProfile(n)); }),
      item('Duplicate…', async () => { const n = await promptDlg('Name for the copy', prof().name + ' copy'); if (n) addProfile(Object.assign(Pr.clone(prof()), { name: n })); }),
      item('Rename…', async () => { const n = await promptDlg('Rename profile', prof().name); if (n) mutate((pp) => { pp.name = n; }, { noAuto: true }); }),
      h('hr'),
      item('Import from file…', () => importFile()),
      item('Export to file', () => exportProfile()),
      h('hr'),
      item('Reset to factory defaults…', async () => {
        if (await confirmDlg('Reset profile', `Reset "${prof().name}" to factory defaults? This resets keymap, actuation and lighting, and removes macros, advanced keys and SOCD. Undo can bring it back.`, 'Reset', true)) {
          const name = prof().name;
          S.socdDraft = null;
          S.editAdv = null;
          S.editMacro = null;
          mutate((pp) => { Object.assign(pp, Pr.defaultProfile(name)); });
        }
      }),
      item('Delete profile…', async () => {
        if (S.profiles.length < 2) { toast('Keep at least one profile.', 'warn'); return; }
        if (await confirmDlg('Delete profile', `Delete "${prof().name}"? This can't be undone.`, 'Delete', true)) {
          delete S.history[S.activeUid];
          S.profiles = S.profiles.filter((p) => p.uid !== S.activeUid);
          S.activeUid = S.profiles[0].uid;
          resetEditors();
          saveProfiles();
          render();
        }
      }, 'danger'));
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 240, btn.left)) + 'px';
    menu.style.top = btn.bottom + window.scrollY + 6 + 'px';
    menu.hidden = false;
  }
  document.addEventListener('mousedown', (e) => { const m = $('menu'); if (!m.hidden && !m.contains(e.target) && e.target !== $('btn-profile-menu')) m.hidden = true; });

  function resetEditors() { stopRecording(); cancelPick(true); S.editAdv = null; S.editMacro = null; S.selKey = null; S.socdDraft = null; S.actSel.clear(); }
  function switchProfile(id) {
    if (id === S.activeUid || !S.profiles.some((p) => p.uid === id)) return;
    resetEditors();
    S.activeUid = id;
    saveProfiles();
    render();
    scheduleAutoApply();
  }
  function addProfile(p) {
    const n = Object.assign(Pr.normalize(p), { uid: uid() });
    resetEditors();
    S.profiles.push(n);
    S.activeUid = n.uid;
    saveProfiles();
    render();
    scheduleAutoApply();
  }
  function importFile() {
    const input = $('file-input');
    input.value = '';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        if (f.size > 2 * 1024 * 1024) throw new Error('file is too large to be a profile');
        const base = f.name.replace(/\.json$/i, '').slice(0, 40);
        const p = Pr.parseImport(await f.text(), base);
        if (!p.name || p.name === 'Imported' || p.name === 'Profile') p.name = base || 'Imported';
        addProfile(p);
        toast(`Imported "${p.name}". Press Apply to write it to the keyboard.`);
      } catch (e) {
        toast('Import failed: ' + (e instanceof SyntaxError ? 'the file is not valid JSON' : e.message), 'err');
      }
    };
    input.click();
  }
  function exportProfile() {
    const p = Pr.clone(prof());
    delete p.uid;
    const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `boog75-${p.name.replace(/[^\w.-]+/g, '_')}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ------------------------------------------------------------- wiring
  $('btn-connect').addEventListener('click', connectClicked);
  $('btn-apply').addEventListener('click', () => apply(false));
  $('btn-profile-menu').addEventListener('click', showProfileMenu);
  $('btn-undo').addEventListener('click', () => undoRedo('undo'));
  $('btn-redo').addEventListener('click', () => undoRedo('redo'));
  $('btn-theme').addEventListener('click', () => {
    S.settings.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    saveSettings();
    applyTheme();
  });
  $('auto-apply').addEventListener('change', (e) => { S.settings.autoApply = e.target.checked; saveSettings(); if (e.target.checked) scheduleAutoApply(); renderHeader(); });
  $('profile-select').addEventListener('change', (e) => switchProfile(e.target.value));
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  window.addEventListener('resize', () => renderKeyboard());
  window.addEventListener('beforeunload', (e) => { if (S.busy) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('storage', (e) => {
    // Another tab changed the stored state: reload it rather than overwrite it later.
    if (e.key === 'boog75.profiles' || e.key === 'boog75.known') {
      if (e.key === 'boog75.known') S.known = store.get('known', {}) || {};
      else { const active = S.activeUid; loadProfiles(); if (S.profiles.some((p) => p.uid === active)) S.activeUid = active; resetEditors(); }
      render();
    }
  });

  applyTheme();
  loadProfiles();
  render();
  if (B.webHidSupported()) dev.autoConnect().catch((e) => toast('Auto-connect failed: ' + e.message, 'warn'));
})();
