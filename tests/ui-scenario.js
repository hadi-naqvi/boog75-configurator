// Scripted UI walkthrough against the fake device (tests/ui-mock.js).
// Reports results via console ("UI-TEST-RESULT {json}") for tests/run-ui-test.sh.
(async function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const mode = params.has('nohid') ? 'nohid' : params.has('fw') ? 'legacy' : 'main';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
  const B = window.Boog, P = B.protocol;
  const results = [];
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    console.log('UI-TEST-RESULT ' + JSON.stringify({ mode, results }));
  };
  setTimeout(() => { results.push({ name: 'scenario finished in time', ok: false, extra: 'watchdog fired' }); report(); }, 80000);

  // ---- helpers
  function expect(cond, msg) { if (!cond) throw new Error(msg || 'expectation failed'); }
  async function step(name, fn) {
    try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, extra: String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ') }); }
  }
  async function waitFor(cond, ms = 3000, what) {
    const t0 = Date.now();
    for (;;) {
      let v; try { v = cond(); } catch (e) { v = false; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + (what || cond.toString().slice(0, 90)));
      await sleep(20);
    }
  }
  const btn = (text, root) => $$('button', root || document).find((b) => b.textContent.trim().startsWith(text));
  const click = (text, root) => { const b = btn(text, root); expect(b, `no button "${text}"`); expect(!b.disabled, `button "${text}" is disabled`); b.click(); };
  const tab = (name) => click(name, $('#tabs'));
  const key = (idx) => $(`#keyboard .key[data-idx="${idx}"]`);
  const press = (idx) => key(idx).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  const applyText = () => $('#btn-apply').textContent;
  const sent = () => window.__sent.length;
  const cmds = (from) => window.__sent.slice(from).map((f) => f[1]).join(',');
  const frame = (i) => window.__sent[i];
  const panel = () => $('#panel').textContent;
  const toasts = () => $('#toasts').textContent;
  const pickCat = (name, root) => click(name, $('.picker .cats', root));
  const pickKeycode = (title, root) => { const b = $$('.picker .grid button', root).find((x) => x.title === title); expect(b, `no keycode "${title}"`); b.click(); };
  async function apply() {
    const mark = sent();
    click('Apply');
    await waitFor(() => !applyText().startsWith('Writing'), 15000, 'apply to finish');
    await sleep(40);
    return mark;
  }
  async function dlgOpen(text, ms) { await waitFor(() => $('#dialog').open && (!text || $('#dialog').textContent.includes(text)), ms || 2000, `dialog "${text}"`); }
  async function dlgClick(label) { click(label, $('#dialog')); await waitFor(() => !$('#dialog').open || !$('#dialog').textContent.includes(label), 2000, 'dialog to close'); await sleep(30); }
  async function menu(label) { $('#btn-profile-menu').click(); await sleep(20); click(label, $('#menu')); await sleep(30); }
  const reachable = (el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  };
  const keydown = (init, target) => (target || document).dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init)));
  const keyup = (init, target) => (target || document).dispatchEvent(new KeyboardEvent('keyup', Object.assign({ bubbles: true, cancelable: true }, init)));
  const blur = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

  await sleep(150);

  await step('page renders: 81 keys, overlays hidden, controls clickable', async () => {
    expect($$('#keyboard .key').length === 81, 'key count');
    expect(getComputedStyle($('#progress')).display === 'none', 'progress overlay hidden');
    expect(getComputedStyle($('#menu')).display === 'none', 'menu hidden');
    expect(!$('#dialog').open, 'dialog closed');
    expect(reachable($('#btn-connect')), 'connect button reachable');
    expect(reachable(key(0)), 'keys reachable');
    expect(['dark', 'light'].includes(document.documentElement.dataset.theme), 'theme set');
    expect($('#footer').textContent.includes('BOOG75 Configurator'), 'footer');
  });

  if (mode === 'nohid') {
    await step('no-WebHID banner and graceful connect', async () => {
      expect($('#banners').textContent.includes('WebHID is not available'), 'banner');
      $('#btn-connect').click();
      await waitFor(() => toasts().includes('no WebHID'), 1000);
      expect($('#btn-apply').disabled, 'apply disabled');
    });
    await step('editing still works offline', async () => {
      press(45);
      pickCat('Control & navigation');
      pickKeycode('Escape');
      await waitFor(() => key(45).textContent.includes('Esc'));
    });
  }

  if (mode === 'legacy') {
    await step('legacy firmware detected', async () => {
      $('#btn-connect').click();
      await waitFor(() => $('#conn-status').textContent.includes('V22'));
      expect($('#banners').textContent.includes('older than V28'), 'legacy banner');
    });
    await step('first sync then legacy Mod-Tap / macro commands', async () => {
      await apply();
      expect(applyText().includes('Up to date'), 'synced');
      tab('Advanced keys');
      click('+ Mod-Tap');
      await sleep(30);
      press(45);
      await waitFor(() => panel().includes('Mod-Tap on'));
      expect(panel().includes('predates Dynamic Keystroke'), 'old-firmware hint');
      let m = await apply();
      expect(cmds(m) === '52,90,90,90', 'cmds ' + cmds(m));
      expect(frame(m)[4] === 0 && frame(m)[5] === 0 && frame(m)[8] === 200 && frame(m)[12] === 20, 'legacy MT layout ' + P.toHex(frame(m)).slice(0, 45));
      tab('Macros');
      click('+ New');
      await sleep(30);
      m = await apply();
      expect(cmds(m) === '96,96,96,96', 'cmds ' + cmds(m));
      expect(frame(m)[3] === 59 && frame(m)[5] === 0, 'legacy macro chunk (no flag byte)');
    });
  }

  if (mode === 'main') {
    await step('connect reads version and lighting', async () => {
      $('#btn-connect').click();
      await waitFor(() => $('#conn-status').textContent.includes('V30'));
      await sleep(80);
      expect(cmds(0) === '2,25', 'reads ' + cmds(0));
      expect($('#banners').textContent.includes('First connection'), 'first-run banner');
      expect(/Apply \d+ changes/.test(applyText()), applyText());
      expect($$('#tabs .pending-dot').length >= 4, 'pending dots on tabs');
    });

    await step('first full sync', async () => {
      const m = await apply();
      const c = window.__sent.slice(m).map((f) => f[1]);
      const n = (x) => c.filter((v) => v === x).length;
      expect(n(0x5a) === 3 && n(0x1c) === 243 && n(0x70) === 6 && n(0x18) === 1 && n(0x34) === 2, 'frame mix ' + JSON.stringify([n(0x5a), n(0x1c), n(0x70), n(0x18), n(0x34)]));
      expect(applyText().includes('Up to date'), applyText());
      expect(getComputedStyle($('#progress')).display === 'none', 'overlay hidden after write');
      expect($$('#tabs .pending-dot').length === 0, 'no pending dots');
      expect(window.__sent.every((f) => P.verifyFrame(f)), 'checksums');
      expect(!$('#banners').textContent.includes('First connection'), 'banner gone');
    });

    await step('remap Caps Lock to Escape (3 base-layer frames)', async () => {
      press(45);
      await waitFor(() => panel().includes('Key "Caps Lock"'));
      pickCat('Control & navigation');
      pickKeycode('Escape');
      await waitFor(() => applyText() === 'Apply 1 change');
      expect(key(45).classList.contains('changed'), 'changed marker');
      expect($('.seg .pending-dot'), 'layer pending dot');
      const m = await apply();
      expect(cmds(m) === '90,90,90', cmds(m));
      expect(frame(m + 1)[37] === 27, 'Caps position now Escape');
    });

    await step('keycode search', async () => {
      const s = $('.picker input[type=search]');
      s.value = 'volume';
      s.dispatchEvent(new Event('input'));
      await waitFor(() => $$('.picker .grid button').some((b) => b.title === 'Volume Up'));
      expect($$('.picker .grid button').every((b) => /volume/i.test(b.title)), 'only matches');
      const s2 = $('.picker input[type=search]');
      s2.value = '';
      s2.dispatchEvent(new Event('input'));
      blur();
    });

    await step('Fn layer edit sends one frame', async () => {
      click('Fn', $('.seg'));
      press(10);
      pickCat('Letters & symbols');
      pickKeycode('A');
      const m = await apply();
      expect(cmds(m) === '28', cmds(m));
      expect(Array.from(frame(m).slice(4, 8)).join(',') === '1,10,65,0', 'layer/idx/vk');
    });

    await step('press a physical key to select it', async () => {
      click('Base', $('.seg'));
      blur();
      keydown({ code: 'KeyQ', key: 'q' });
      await waitFor(() => panel().includes('Key "Q"'));
    });

    await step('undo / redo', async () => {
      pickCat('Letters & symbols');
      pickKeycode('B');
      await waitFor(() => applyText() === 'Apply 1 change');
      blur();
      keydown({ key: 'z', code: 'KeyZ', ctrlKey: true });
      await waitFor(() => applyText() === 'Up to date', 1000, 'undo');
      expect(!$('#btn-redo').disabled, 'redo enabled');
      $('#btn-redo').click();
      await waitFor(() => applyText() === 'Apply 1 change', 1000, 'redo');
      $('#btn-undo').click();
      await waitFor(() => applyText() === 'Up to date', 1000, 'undo again');
    });

    await step('copy a layer', async () => {
      click('Fn + Shift + Alt', $('.seg'));
      const sel = $('select[aria-label="Copy keys from layer"]');
      sel.value = '1';
      sel.dispatchEvent(new Event('change'));
      await dlgOpen('Copy layer');
      await dlgClick('Copy');
      await waitFor(() => /Apply/.test(applyText()) && !applyText().includes('Up to date'));
      const m = await apply();
      const c = window.__sent.slice(m).map((f) => f[1]);
      expect(c.length > 40 && c.every((x) => x === 0x1c), `copied ${c.length} keys`);
      expect(window.__sent.slice(m).every((f) => f[4] === 3), 'all on layer 3');
    });

    await step('removing the only Fn key asks first', async () => {
      click('Base', $('.seg'));
      press(77);
      await waitFor(() => panel().includes('Key "Fn"'));
      click('Disable key');
      await dlgOpen('Remove the Fn key?');
      expect(document.activeElement && document.activeElement.textContent === 'Cancel', 'Cancel focused for a destructive action');
      await dlgClick('Cancel');
      await sleep(30);
      expect(applyText() === 'Up to date', 'nothing changed');
    });

    await step('no panel renders stray "null" / "[object" text', async () => {
      for (const t of ['Keymap', 'Actuation', 'Advanced keys', 'Macros', 'Lighting', 'Device']) {
        tab(t);
        expect(!/\[object |\bnull\b|undefined/.test(panel()), `${t} panel contains stray text`);
      }
      tab('Keymap');
    });

    await step('lighting effects incl. extra effects', async () => {
      tab('Lighting');
      click('Breathing');
      let m = await apply();
      expect(cmds(m) === '24' && frame(m)[5] === 3, cmds(m));
      click('Show more effects');
      click('Laser');
      m = await apply();
      expect(cmds(m) === '24' && frame(m)[5] === 9, 'laser');
      $('.swatch[data-slot="3"]').click();
      m = await apply();
      expect(frame(m)[8] === 3, 'colour slot');
    });

    await step('actuation presets and toggle keys', async () => {
      tab('Actuation');
      click('Select all');
      click('Gaming');
      click('Set 0.4 / 0.3');
      click('Select WASD');
      click('Make selected toggle');
      const m = await apply();
      expect(cmds(m) === '112,112,112,112,112,112', cmds(m));
      expect(Array.from(frame(m).slice(5, 9)).join(',') === '0,2,4,3', 'key 0');
      expect(frame(m + 2)[17] === 32 && frame(m + 2)[18] === 4, 'W is toggle');
    });

    await step('drag-select keys', async () => {
      click('Clear');
      key(31).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      key(32).dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      key(33).dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await waitFor(() => panel().includes('3 keys selected'));
    });

    await step('Mod-Tap on Caps Lock', async () => {
      tab('Advanced keys');
      click('+ Mod-Tap');
      await sleep(30);
      expect(key(77).classList.contains('disabled'), 'Fn cannot become an advanced key');
      press(45);
      await waitFor(() => panel().includes('Mod-Tap on'));
      const m = await apply();
      expect(cmds(m) === '96,90,90,90', cmds(m));
      const f = frame(m);
      expect(f[4] === 16 && f[5] === 4 && f[6] === 0 && f[8] === 4 && f[9] === 3 && f[10] === 200 && f[14] === 27, P.toHex(f).slice(0, 60));
      expect(frame(m + 2)[37] === 218 && frame(m + 2)[38] === 0, 'keymap marks advanced key');
    });

    await step('Dynamic Keystroke: add, edit a stage, remove', async () => {
      click('+ Dynamic Keystroke');
      await sleep(30);
      press(30);
      await waitFor(() => panel().includes('Dynamic Keystroke on'));
      let m = await apply();
      expect(cmds(m) === '96,90,90,90', cmds(m));
      const f = frame(m);
      expect([f[4], f[5], f[6], f[7], f[8], f[9], f[10], f[11], f[12], f[13], f[14]].join(',') === '0,4,1,3,16,36,36,16,255,0,9', P.toHex(f).slice(0, 50));
      const sel = $('select[aria-label="Binding 1, ④ Release past end point"]');
      sel.value = '0';
      sel.dispatchEvent(new Event('change'));
      m = await apply();
      expect(cmds(m) === '96' && frame(m)[13] === 2, 'stage 4 tap mask');
      const item = $$('.list .item').find((x) => x.textContent.includes('DKS'));
      click('✕', item);
      m = await apply();
      expect(cmds(m) === '90,90,90' && frame(m + 1)[7] === 9, 'Tab restored');
    });

    await step('Snappy Tappy on A / D', async () => {
      click('Snappy Tappy');
      $('[data-socd="a"]').click();
      await sleep(30);
      press(46);
      await sleep(30);
      $('[data-socd="b"]').click();
      await sleep(30);
      press(48);
      await sleep(30);
      const m = await apply();
      expect(cmds(m) === '52,52,52', cmds(m));
      const f = frame(m + 2);
      expect(f[7] === 1 && f[9] === 0 && f[10] === 46 && f[11] === 48, P.toHex(f).slice(0, 40));
    });

    await step('macro: record, add tap, write, assign to a key', async () => {
      tab('Macros');
      click('+ New');
      await waitFor(() => panel().includes('Run mode'));
      click('● Record');
      keydown({ code: 'KeyA', key: 'a' });
      await sleep(30);
      keyup({ code: 'KeyA', key: 'a' });
      click('■ Stop recording');
      await waitFor(() => panel().includes('Steps (2/60)'), 1000, 'recorded steps');
      click('+ Key tap');
      await dlgOpen('Add key tap');
      pickCat('Letters & symbols', $('#dialog'));
      pickKeycode('B', $('#dialog'));
      await waitFor(() => panel().includes('Steps (4/60)'), 1000, 'tap added');
      let m = await apply();
      expect(cmds(m) === '96,96,96,96', cmds(m));
      const f = frame(m);
      expect(f[5] === 1 && f[6] === 0 && f[42] === 65 && f[44] === 128, P.toHex(f).slice(0, 140));
      tab('Keymap');
      press(60);
      pickCat('Macros');
      pickKeycode('Macro 1');
      m = await apply();
      expect(cmds(m) === '90,90,90' && frame(m + 2)[9] === 152 && frame(m + 2)[10] === 0, 'Z is macro 1');
    });

    await step('read macros from the keyboard', async () => {
      tab('Device');
      click('Read macros');
      await dlgOpen('Found 1 macro', 15000);
      await dlgClick('Replace');
      const p = JSON.parse(localStorage.getItem('boog75.profiles')).find((x) => x.uid === JSON.parse(localStorage.getItem('boog75.active')));
      expect(p.macros.length === 1 && p.macros[0].id === 4 && p.macros[0].name === 'Hi' && p.macros[0].count === 2 && p.macros[0].steps.length === 2, JSON.stringify(p.macros));
      expect(p.layers[0][60].vk === 90, 'key using a vanished macro reverted');
    });

    await step('auto-apply', async () => {
      $('#auto-apply').click();
      tab('Lighting');
      const m = sent();
      click('Static');
      await waitFor(() => applyText() === 'Up to date' && sent() > m, 4000, 'auto apply');
      expect(cmds(m).split(',').includes('24'), cmds(m));
      $('#auto-apply').click();
      expect(!$('#auto-apply').checked, 'off again');
    });

    await step('dry run logs instead of sending', async () => {
      tab('Device');
      $('#opt-dry').click();
      try {
        expect($('#log'), 'protocol log is shown');
        tab('Lighting');
        click('Snake');
        const m = await apply();
        expect(sent() === m, 'nothing sent');
        expect(applyText() === 'Apply 1 change', 'still pending');
        tab('Device');
        expect($('#log').textContent.includes('DRY'), 'log shows DRY frames');
      } finally {
        tab('Device');
        if ($('#opt-dry').checked) $('#opt-dry').click();
      }
      const m2 = await apply();
      expect(cmds(m2) === '24', 'real write after dry run');
    });

    await step('a failing write is reported and can be retried', async () => {
      window.__dev.mode = 'throw';
      tab('Lighting');
      click('Rotate');
      await apply();
      expect(toasts().includes('Writing to the keyboard failed'), 'error toast');
      expect(applyText() === 'Apply 1 change', 'still pending');
      window.__dev.mode = 'normal';
      await apply();
      expect(applyText() === 'Up to date', 'retry worked');
    });

    await step('a stalled keyboard times out instead of hanging', async () => {
      B.Boog75Device.timing.writeTimeout = 300;
      window.__dev.mode = 'hang';
      click('Fountain');
      click('Apply');
      await waitFor(() => $('#conn-status').textContent.includes('Not connected'), 4000, 'disconnect after stall');
      await waitFor(() => !applyText().startsWith('Writing'), 2000);
      expect(toasts().includes('stopped responding'), 'stall toast');
      expect(getComputedStyle($('#progress')).display === 'none', 'overlay gone');
      window.__dev.mode = 'normal';
      B.Boog75Device.timing.writeTimeout = 3000;
      $('#btn-connect').click();
      await waitFor(() => $('#conn-status').textContent.includes('V30'), 3000, 'reconnect');
      await sleep(100);
      await apply();
      expect(applyText() === 'Up to date', 'synced after reconnect');
    });

    await step('forget keyboard state forces a full write', async () => {
      tab('Device');
      click('Forget keyboard state');
      await dlgOpen('Forget keyboard state');
      await dlgClick('Forget');
      expect(/Apply \d+ changes/.test(applyText()), applyText());
      const m = await apply();
      expect(sent() - m > 250 && applyText() === 'Up to date', 'full write');
    });

    await step('profiles: new, rename, duplicate, delete, switch', async () => {
      const first = $('#profile-select').value;
      await menu('New profile…');
      await dlgOpen('New profile name');
      $('#dialog input').value = 'Second';
      await dlgClick('OK');
      expect($('#profile-select').options.length === 2 && $('#profile-select').selectedOptions[0].textContent === 'Second', 'new');
      await menu('Rename…');
      await dlgOpen('Rename profile');
      $('#dialog input').value = 'Renamed';
      await dlgClick('OK');
      expect($('#profile-select').selectedOptions[0].textContent === 'Renamed', 'rename');
      await menu('Duplicate…');
      await dlgOpen('Name for the copy');
      await dlgClick('OK');
      expect($('#profile-select').options.length === 3, 'duplicate');
      await menu('Delete profile…');
      await dlgOpen('Delete profile');
      await dlgClick('Delete');
      expect($('#profile-select').options.length === 2, 'delete');
      const sel = $('#profile-select');
      sel.value = first;
      sel.dispatchEvent(new Event('change'));
      await sleep(30);
      expect($('#profile-select').value === first, 'switch');
    });

    await step('import an official export', async () => {
      const json = JSON.stringify({ keyMap0: [[{ idx: 0, vkCode: 192, rapidTrigger: { make: 0.5, break: 0.5 } }]], rgbEffect: { lightOn: 1, lightEffect: 2, lightBrightness: 4, lightSpeed: 1, currentLedColorIndex: 0 } });
      const before = $('#profile-select').options.length;
      await menu('Import from file…');
      const dt = new DataTransfer();
      dt.items.add(new File([json], 'My exclusive config1.json', { type: 'application/json' }));
      const input = $('#file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      await waitFor(() => $('#profile-select').options.length === before + 1, 2000, 'imported');
      expect($('#profile-select').selectedOptions[0].textContent === 'My exclusive config1', 'named after file');
      expect(toasts().includes('Imported'), 'toast');
      tab('Keymap');
      expect(key(0).textContent.includes('`'), 'imported key shown');
      const bad = new DataTransfer();
      bad.items.add(new File(['{oops'], 'bad.json'));
      await menu('Import from file…');
      input.files = bad.files;
      input.dispatchEvent(new Event('change'));
      await waitFor(() => toasts().includes('not valid JSON'), 2000, 'bad file rejected');
    });

    await step('export a profile', async () => {
      let captured = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { captured = { href: this.href, download: this.download }; };
      try { await menu('Export to file'); } finally { HTMLAnchorElement.prototype.click = orig; }
      expect(captured && captured.download === 'boog75-My_exclusive_config1.json', JSON.stringify(captured));
      const data = JSON.parse(await (await fetch(captured.href)).text());
      expect(data.format === 'boog75-config' && !('uid' in data) && data.keys[0].make === 5, 'export content');
      expect(B.profile.parseImport(JSON.stringify(data)).name === 'My exclusive config1', 'export re-imports');
    });

    await step('theme toggle persists', async () => {
      const t0 = document.documentElement.dataset.theme;
      $('#btn-theme').click();
      const t1 = document.documentElement.dataset.theme;
      expect(t1 !== t0, 'theme changed');
      expect(JSON.parse(localStorage.getItem('boog75.settings')).theme === t1, 'saved');
      $('#btn-theme').click();
    });

    await step('Escape closes the profile menu', async () => {
      $('#btn-profile-menu').click();
      await sleep(20);
      expect(!$('#menu').hidden, 'menu open');
      blur();
      keydown({ key: 'Escape', code: 'Escape' });
      expect($('#menu').hidden, 'menu closed');
    });

    await step('unplugging is handled', async () => {
      window.__dev.opened = false;
      const ev = new Event('disconnect'); ev.device = window.__dev; navigator.hid.dispatchEvent(ev);
      await waitFor(() => $('#conn-status').textContent.includes('Not connected'), 1000);
      expect($('#btn-apply').disabled, 'apply disabled while disconnected');
    });
  }

  await step('no uncaught errors', async () => { expect(window.__errors.length === 0, window.__errors.join(' ; ')); });
  report();
})();
