// Profile model: defaults, validation/normalisation, import of official
// exports, and the diff that turns "profile vs. what's on the keyboard" into frames.
(function (root) {
  'use strict';
  const B = (root.Boog = root.Boog || {});
  const P = B.protocol;
  const L = B.layout;
  const VK = B.keycodes.VK;
  const N = L.KEY_COUNT;

  const DEFAULT_COLORS = ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clampInt = (v, lo, hi, dflt) => {
    v = Math.round(Number(v));
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  };

  function defaultProfile(name) {
    return {
      format: 'boog75-config',
      version: 1,
      name: name || 'Default',
      layers: L.defaultLayers.map((layer) => layer.map((vk) => ({ vk, ext: 0 }))),
      keys: Array.from({ length: N }, () => ({ make: 10, brk: 10, tgl: false })),
      rgb: { on: 1, effect: 1, brightness: 9, speed: 2, colorIndex: 0, colors: DEFAULT_COLORS.slice() },
      macros: [],
      advanced: [],
      socd: null,
    };
  }

  function emptyDksBinding() {
    return { vk: 0, stages: [0, 1, 2, 3].map(() => ({ on: false, span: 0 })) };
  }

  // Repair anything inconsistent so encoding can never fail on a loaded profile.
  function normalize(input) {
    const d = defaultProfile(); // pristine fallbacks
    const src = input && typeof input === 'object' && !Array.isArray(input) ? clone(input) : {};
    const p = Object.assign(defaultProfile(), src);
    p.format = 'boog75-config';
    p.version = 1;
    p.name = String(p.name || 'Profile').slice(0, 40);

    if (!Array.isArray(p.layers) || p.layers.length !== 4) p.layers = d.layers;
    p.layers = p.layers.map((layer, li) => Array.from({ length: N }, (_, i) => {
      const k = layer && layer[i];
      const vk = k && Number.isInteger(k.vk) && k.vk >= 0 && k.vk <= 255 ? k.vk : L.defaultLayers[li][i];
      const ext = k && Number.isInteger(k.ext) && k.ext >= 0 && k.ext <= 255 ? k.ext : 0;
      return { vk, ext: vk === VK.MACRO || vk === VK.ADVANCED_KEY ? ext : 0 };
    }));

    if (!Array.isArray(p.keys) || p.keys.length !== N) p.keys = d.keys;
    p.keys = p.keys.map((k) => ({
      make: clampInt(k && k.make, 1, 40, 10),
      brk: clampInt(k && k.brk, 1, 40, 10),
      tgl: !!(k && k.tgl),
    }));

    const r = p.rgb || {};
    p.rgb = {
      on: r.on ? 1 : 0,
      effect: clampInt(r.effect, 0, 15, 1),
      brightness: clampInt(r.brightness, 0, 9, 9),
      speed: clampInt(r.speed, 0, 3, 2),
      colorIndex: clampInt(r.colorIndex, 0, 6, 0),
      colors: DEFAULT_COLORS.map((c, i) => (Array.isArray(r.colors) && /^#[0-9a-f]{6}$/i.test(r.colors[i]) ? r.colors[i].toLowerCase() : c)),
    };

    const seenMacro = new Set();
    p.macros = (Array.isArray(p.macros) ? p.macros : [])
      .filter((m) => m && Number.isInteger(m.id) && m.id >= 0 && m.id < P.MAX_MACROS && !seenMacro.has(m.id) && seenMacro.add(m.id))
      .map((m) => ({
        id: m.id,
        name: String(m.name || '').slice(0, 10),
        mode: ['hold', 'toggle', 'count'].includes(m.mode) ? m.mode : 'count',
        count: clampInt(m.count, 1, 253, 1),
        steps: (Array.isArray(m.steps) ? m.steps : []).slice(0, P.MAX_MACRO_STEPS)
          .filter((s) => s && Number.isInteger(s.vk) && s.vk > 0 && s.vk <= 255)
          .map((s) => ({ vk: s.vk, down: !!s.down, delay: 5 * Math.round(clampInt(s.delay, 0, 1000, 10) / 5) })),
      }))
      .sort((a, b) => a.id - b.id);

    const seenAdv = new Set();
    const usedKeys = new Set();
    p.advanced = (Array.isArray(p.advanced) ? p.advanced : [])
      .filter((a) => a && Number.isInteger(a.id) && a.id >= 0 && a.id < P.MAX_ADVANCED && !seenAdv.has(a.id)
        && Number.isInteger(a.key) && a.key >= 0 && a.key < N && !usedKeys.has(a.key)
        && (a.type === 'DKS' || a.type === 'MT') && seenAdv.add(a.id) && usedKeys.add(a.key))
      .map((a) => a.type === 'DKS'
        ? {
          id: a.id, type: 'DKS', key: a.key, origVk: clampInt(a.origVk, 0, 255, L.defaultLayers[0][a.key]),
          first: clampInt(a.first, 1, 35, 16), last: clampInt(a.last, 1, 35, 16),
          bindings: [0, 1, 2, 3].map((i) => {
            const b = (a.bindings || [])[i] || emptyDksBinding();
            return {
              vk: clampInt(b.vk, 0, 255, 0),
              stages: [0, 1, 2, 3].map((s) => {
                const st = (b.stages || [])[s] || {};
                return { on: !!st.on, span: clampInt(st.span, 0, 3 - s, 0) };
              }),
            };
          }),
        }
        : {
          id: a.id, type: 'MT', key: a.key, origVk: clampInt(a.origVk, 0, 255, L.defaultLayers[0][a.key]),
          holdVk: clampInt(a.holdVk, 0, 255, 0), tapVk: clampInt(a.tapVk, 0, 255, 0),
          holdMs: clampInt(a.holdMs, 10, 1000, 200),
        });

    const s = p.socd;
    if (s && (s.type === 'RS' || s.type === 'ST') && Number.isInteger(s.a) && Number.isInteger(s.b)
      && s.a >= 0 && s.a < N && s.b >= 0 && s.b < N && s.a !== s.b) {
      p.socd = { type: s.type, a: s.a, b: s.b, priority: clampInt(s.priority, 0, 3, 0), fullPressAlt: s.fullPressAlt !== false };
    } else p.socd = null;

    // Keymap <-> advanced/macro consistency.
    const advByKey = new Map(p.advanced.map((a) => [a.key, a]));
    const macroIds = new Set(p.macros.map((m) => m.id));
    p.layers.forEach((layer, li) => layer.forEach((k, i) => {
      if (li === 0 && advByKey.has(i)) { layer[i] = { vk: VK.ADVANCED_KEY, ext: advByKey.get(i).id }; return; }
      if (k.vk === VK.ADVANCED_KEY) layer[i] = { vk: L.defaultLayers[li][i], ext: 0 };
      else if (k.vk === VK.MACRO && !macroIds.has(k.ext)) layer[i] = { vk: L.defaultLayers[li][i], ext: 0 };
    }));
    return p;
  }

  // ------------------------------------------------ official-tool import
  // Accepts the JSON produced by "Export profile" on boog75.meletrix.com.
  function fromOfficial(j, name) {
    const p = defaultProfile(name || 'Imported');
    const grid = (m) => (Array.isArray(m) ? m.flat() : []);
    ['keyMap0', 'keyMap1', 'keyMap2', 'keyMap3'].forEach((k, li) => {
      grid(j[k] || (li === 0 ? j.keyMap : null)).forEach((e) => {
        if (!e || !Number.isInteger(e.idx) || e.idx < 0 || e.idx >= N) return;
        const vk = Number(e.vkCode);
        let ext = 0;
        if (vk === VK.MACRO) ext = Number(e.macroId) || 0;
        if (vk === VK.ADVANCED_KEY) ext = Number(e.advancedKeyId) || 0;
        p.layers[li][e.idx] = { vk, ext };
      });
    });
    grid(j.keyMap0 || j.keyMap).forEach((e) => {
      if (!e || !Number.isInteger(e.idx) || e.idx < 0 || e.idx >= N) return;
      const rt = e.rapidTrigger || {};
      p.keys[e.idx] = { make: Math.round(10 * (rt.make || 1)), brk: Math.round(10 * (rt.break || 1)), tgl: e.triggerMode === 4 };
    });
    const r = j.rgbEffect;
    if (r) {
      p.rgb = {
        on: r.lightOn, effect: r.lightEffect, brightness: r.lightBrightness, speed: r.lightSpeed, colorIndex: r.currentLedColorIndex,
        colors: [0, 1, 2, 3, 4, 5, 6].map((i) => (r['lightColor' + i] && r['lightColor' + i].hex) || DEFAULT_COLORS[i]),
      };
    }
    p.macros = (j.macroList || []).map((m) => ({
      id: m.id, name: m.title,
      mode: m.executeType === 0 ? 'hold' : m.executeType === 1 ? 'toggle' : 'count',
      count: m.executeCount || 1,
      steps: (m.data || []).map((s) => ({ vk: Number(s.vkCode), down: s.keyState === 1, delay: s.spanTime })),
    }));
    (j.advancedKeyList || []).forEach((a) => {
      if (a.type === 'DKS' && a.dks) {
        p.advanced.push({
          id: a.id, type: 'DKS', key: a.keyIndex, origVk: Number(a.vkCode) || undefined,
          first: Math.round(10 * (a.fitstTriggerPos || 1.6)), last: Math.round(10 * (a.lastTriggerPos || 1.6)),
          bindings: a.dks.map((b) => ({
            vk: Number(b.vkCode) || 0,
            stages: (b.data || []).map((st) => ({ on: !!st.visible, span: st.dataType || 0 })),
          })),
        });
      } else if (a.type === 'MT' && a.mt) {
        p.advanced.push({
          id: a.id, type: 'MT', key: a.keyIndex, origVk: Number(a.vkCode) || undefined,
          holdVk: Number(a.mt[0] && a.mt[0].vkCode) || 0, tapVk: Number(a.mt[1] && a.mt[1].vkCode) || 0, holdMs: a.pressTime || 200,
        });
      } else if ((a.type === 'RS' && a.rs) || (a.type === 'ST' && a.st)) {
        const pair = a.rs || a.st;
        p.socd = {
          type: a.type, a: Number(pair[0] && pair[0].keyIndex), b: Number(pair[1] && pair[1].keyIndex),
          priority: a.socdType || 0, fullPressAlt: a.fullPress !== 1,
        };
      }
    });
    return normalize(p);
  }

  function parseImport(text, fallbackName) {
    const j = JSON.parse(text);
    if (j && j.format === 'boog75-config') return normalize(j);
    if (j && (j.keyMap0 || j.keyMap || j.rgbEffect)) return fromOfficial(j, fallbackName);
    throw new Error('Not a BOOG75 profile file');
  }

  // ------------------------------------------------------------- syncing
  // known: what we believe is on the keyboard (same shape as a profile,
  // any section may be undefined = unknown). Returns ordered steps.
  function planSync(p, known, newProtocol) {
    known = known || {};
    const steps = [];
    const push = (section, label, frames, apply) => { if (frames.length) steps.push({ section, label, frames, apply }); };

    // 1. Macros first, so keys that reference them are valid.
    const knownMacros = known.macros ? new Map(known.macros.map((m) => [m.id, m])) : null;
    p.macros.forEach((m) => {
      if (knownMacros && eq(knownMacros.get(m.id), m)) return;
      push('macros', `Macro ${m.id + 1}${m.name ? ' "' + m.name + '"' : ''}`, P.setMacro(m, newProtocol), (k) => {
        k.macros = (k.macros || []).filter((x) => x.id !== m.id).concat([clone(m)]);
      });
    });
    if (knownMacros) {
      const ids = new Set(p.macros.map((m) => m.id));
      knownMacros.forEach((m, id) => {
        if (!ids.has(id)) push('macros', `Delete macro ${id + 1}`, P.deleteMacro(id), (k) => { k.macros = (k.macros || []).filter((x) => x.id !== id); });
      });
    }

    // 2. Advanced key definitions (MT also embeds the key's actuation values).
    const knownAdv = known.advanced ? new Map(known.advanced.map((a) => [a.id, a])) : null;
    p.advanced.forEach((a) => {
      const keyTrig = p.keys[a.key];
      const knownTrig = known.keys && known.keys[a.key];
      const sameTrig = a.type !== 'MT' || (knownTrig && knownTrig.make === keyTrig.make && knownTrig.brk === keyTrig.brk);
      if (knownAdv && eq(knownAdv.get(a.id), a) && sameTrig) return;
      const frames = a.type === 'DKS' ? P.setDks(a, newProtocol) : P.setModTap(a, keyTrig.make, keyTrig.brk, newProtocol);
      push('advanced', `${a.type === 'DKS' ? 'Dynamic keystroke' : 'Mod-tap'} on ${B.keycodes.label(L.defaultLayers[0][a.key]).replace(/\n/g, ' ')}`, frames, (k) => {
        k.advanced = (k.advanced || []).filter((x) => x.id !== a.id).concat([clone(a)]);
      });
    });

    // 3. Keymaps.
    if (!known.layers || !eq(known.layers[0], p.layers[0])) {
      push('keymap', 'Base layer keymap', P.setBaseKeymap(p.layers[0]), (k) => {
        k.layers = k.layers || [null, null, null, null];
        k.layers[0] = clone(p.layers[0]);
        k.advanced = (k.advanced || []).filter((x) => p.advanced.some((a) => a.id === x.id));
      });
      steps[steps.length - 1].layer = 0;
    }
    for (let li = 1; li < 4; li++) {
      const kl = known.layers && known.layers[li];
      const frames = [];
      p.layers[li].forEach((key, i) => {
        if (!kl || !eq(kl[i], key)) frames.push(...P.setLayerKey(li, i, key));
      });
      push('keymap', `${L.layerNames[li]} layer (${frames.length} key${frames.length === 1 ? '' : 's'})`, frames, (k) => {
        k.layers = k.layers || [null, null, null, null];
        k.layers[li] = clone(p.layers[li]);
      });
      if (frames.length) steps[steps.length - 1].layer = li;
    }

    // 4. Actuation / rapid trigger / toggle.
    if (!known.keys || !eq(known.keys, p.keys)) {
      push('actuation', 'Actuation & rapid trigger', P.setTriggers(p.keys), (k) => { k.keys = clone(p.keys); });
    }

    // 5. Lighting.
    if (!known.rgb || !eq(known.rgb, p.rgb)) {
      push('lighting', 'Lighting', P.setRgb(p.rgb), (k) => { k.rgb = clone(p.rgb); });
    }

    // 6. SOCD (Rappy Snappy / Snappy Tappy). Always clear both slots first so
    //    switching between RS and ST never leaves a stale pair active.
    if (!('socd' in known) || !eq(known.socd, p.socd)) {
      const frames = P.clearSocd();
      if (p.socd) frames.push(...P.setSocd(p.socd));
      push('advanced', p.socd ? (p.socd.type === 'RS' ? 'Rappy Snappy' : 'Snappy Tappy (SOCD)') : 'Clear SOCD', frames, (k) => { k.socd = clone(p.socd); });
    }
    return steps;
  }

  B.profile = { defaultProfile, normalize, fromOfficial, parseImport, planSync, emptyDksBinding, clone, eq, DEFAULT_COLORS };
})(typeof window !== 'undefined' ? window : globalThis);
