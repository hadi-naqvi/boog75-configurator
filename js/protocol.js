// BOOG75 USB protocol: pure encoders/decoders, no I/O.
//
// Transport: HID interface with usage page 0xFF01, no report ID, 64-byte reports.
// Frame layout: [0x00, cmd, 0x00, len, sub, data..., checksum, 0-padding]
//   - the checksum byte directly follows the payload; all bytes up to and
//     including it sum to 0x55 (mod 256)
//   - every frame produced here is byte-identical to what the official
//     configurator (boog75.meletrix.com) sends for the same settings
(function (root) {
  'use strict';
  const B = (root.Boog = root.Boog || {});

  const REPORT_SIZE = 64;
  const VENDOR_ID = 0x36b5;
  const PRODUCT_ID = 0x2f8f;
  const USAGE_PAGE = 0xff01;

  const CMD = {
    VERSION: 0x02,
    ACK: 0x05,
    SERIAL: 0x0d,
    SET_RGB: 0x18,
    GET_RGB: 0x19,
    SET_LAYER_KEY: 0x1c,
    SET_LEGACY: 0x34, // SOCD pairs, and DKS/MT on firmware < V28
    SET_KEYMAP: 0x5a,
    KEYMAP_DATA: 0x5b,
    SET_DATA: 0x60, // macros, and DKS/MT on firmware >= V28
    GET_MACRO: 0x61,
    SET_TRIGGER: 0x70,
    TRIGGER_DATA: 0x71,
  };
  const KNOWN_RX = new Set([CMD.VERSION, CMD.ACK, CMD.GET_RGB, CMD.KEYMAP_DATA, CMD.TRIGGER_DATA, CMD.SERIAL, CMD.GET_MACRO]);

  const KEY_COUNT = 81;
  const MAX_MACROS = 40;
  const MAX_MACRO_STEPS = 60;
  const MAX_ADVANCED = 20;
  const DKS_BOTTOM_OUT = 36; // 3.6 mm, fixed by the official tool
  const SOCD_MODE = { ST: 1, RS: 2 };
  const NEW_PROTOCOL_MIN_VERSION = 0x28;
  const TESTED_MAX_VERSION = 0x30;

  function assertByte(v, what) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError(`${what}: invalid byte value ${v}`);
    return v;
  }
  function assertRange(v, lo, hi, what) {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${what} must be an integer in ${lo}..${hi} (got ${v})`);
    return v;
  }

  // Build a frame from the payload bytes; the checksum goes right after them.
  function frame(payload) {
    if (payload.length > REPORT_SIZE - 1) throw new RangeError('payload too long');
    const out = new Uint8Array(REPORT_SIZE);
    let sum = 0;
    payload.forEach((v, i) => {
      out[i] = assertByte(v === undefined ? 0 : v, `byte ${i}`);
      sum += out[i];
    });
    out[payload.length] = (0x55 - sum) & 0xff;
    return out;
  }
  const zeros = (n) => new Array(n).fill(0);
  // Most commands use a 63-byte payload, reads use 62.
  function padded(head, total) {
    const p = zeros(total);
    head.forEach((v, i) => (p[i] = v));
    return p;
  }

  function verifyFrame(f) {
    // Returns true if some prefix ending in a checksum sums to 0x55. Used by tests.
    let sum = 0;
    for (let i = 0; i < f.length; i++) {
      if (((sum + f[i]) & 0xff) === 0x55 && f.slice(i + 1).every((b) => b === 0)) return true;
      sum += f[i];
    }
    return false;
  }

  // ---------------------------------------------------------------- requests
  const getVersion = () => [frame(padded([0, CMD.VERSION], 62))];
  const getRgb = () => [frame(padded([0, CMD.GET_RGB], 62))];
  function getMacro(id) {
    assertRange(id, 0, MAX_MACROS - 1, 'macro id');
    return [0, 1, 2, 3].map((t) => frame(padded([0, CMD.GET_MACRO, 0, 2, 0x40 | t, id], 62)));
  }

  // ------------------------------------------------------------------- RGB
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) throw new RangeError('bad colour ' + hex);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function setRgb(rgb) {
    assertRange(rgb.effect, 0, 8, 'effect');
    assertRange(rgb.brightness, 0, 9, 'brightness');
    assertRange(rgb.speed, 0, 3, 'speed');
    assertRange(rgb.colorIndex, 0, 6, 'colour slot');
    if (!Array.isArray(rgb.colors) || rgb.colors.length !== 7) throw new RangeError('need 7 colours');
    const p = padded([0, CMD.SET_RGB, 0, 26, rgb.on ? 1 : 0, rgb.effect, rgb.brightness, 3 - rgb.speed, rgb.colorIndex], 63);
    rgb.colors.forEach((c, i) => hexToRgb(c).forEach((v, j) => (p[9 + 3 * i + j] = v)));
    return [frame(p)];
  }

  // ---------------------------------------------------------------- keymap
  function checkKey(k, what) {
    assertByte(k.vk, what + ' keycode');
    assertByte(k.ext || 0, what + ' extra byte');
  }
  // Base layer: all 81 keys in three chunks of 29.
  function setBaseKeymap(keys) {
    if (keys.length !== KEY_COUNT) throw new RangeError('base layer needs 81 keys');
    const frames = [];
    for (let c = 0; c * 29 < KEY_COUNT; c++) {
      const chunk = keys.slice(c * 29, c * 29 + 29);
      const p = padded([0, CMD.SET_KEYMAP, 0, 2 * chunk.length + 1, 0x30 | c], 63);
      chunk.forEach((k, i) => {
        checkKey(k, `key ${c * 29 + i}`);
        p[5 + 2 * i] = k.vk;
        p[6 + 2 * i] = k.ext || 0;
      });
      frames.push(frame(p));
    }
    return frames;
  }
  // Fn layers 1..3: one frame per key.
  function setLayerKey(layer, idx, key) {
    assertRange(layer, 1, 3, 'layer');
    assertRange(idx, 0, KEY_COUNT - 1, 'key index');
    checkKey(key, `layer ${layer} key ${idx}`);
    return [frame(padded([0, CMD.SET_LAYER_KEY, 0, 4, layer, idx, key.vk, key.ext || 0], 63))];
  }

  // -------------------------------------------------------------- triggers
  // keys[i] = { make, brk } in units of 0.1 mm (1..40), tgl: bool
  const TRIGGER_MODE_NORMAL = 2;
  const TRIGGER_MODE_TOGGLE = 4;
  function setTriggers(keys) {
    if (keys.length !== KEY_COUNT) throw new RangeError('need 81 trigger entries');
    const stream = [];
    keys.forEach((k, idx) => {
      assertRange(k.make, 1, 40, `key ${idx} actuation`);
      assertRange(k.brk, 1, 40, `key ${idx} release`);
      stream.push(idx, k.tgl ? TRIGGER_MODE_TOGGLE : TRIGGER_MODE_NORMAL, k.make, k.brk);
    });
    const frames = [];
    for (let c = 0; c < 6; c++) {
      const part = stream.slice(c * 58, c * 58 + 58);
      frames.push(frame(padded([0, CMD.SET_TRIGGER, 0, part.length + 1, 0x60 | c, ...part], 63)));
    }
    return frames;
  }

  // ----------------------------------------------------------- DKS / MT
  // DKS stage masks. A binding can fire at each of the 4 stages:
  //   0 = pressed past first actuation, 1 = bottomed out,
  //   2 = released from bottom-out, 3 = released past last actuation.
  // span = how many further stages the key stays held (0 = tap).
  const DKS_MASKS = [
    [0x001, 0x003, 0x01f, 0x0ff],
    [0x008, 0x018, 0x0f8],
    [0x040, 0x0c0],
    [0x200],
  ];
  function dksMask(stages) {
    let m = 0;
    stages.forEach((st, s) => {
      if (!st || !st.on) return;
      const span = st.span || 0;
      if (DKS_MASKS[s][span] === undefined) throw new RangeError(`DKS stage ${s + 1}: invalid hold span ${span}`);
      m |= DKS_MASKS[s][span];
    });
    return [m & 255, (m >> 8) & 255];
  }

  // dks = { id, first, last (0.1 mm units 1..35), bindings: [ {vk, stages:[{on,span}]x4} ] x4 }
  function setDks(dks, newProtocol) {
    assertRange(dks.id, 0, MAX_ADVANCED - 1, 'advanced key id');
    assertRange(dks.first, 1, 35, 'DKS start actuation');
    assertRange(dks.last, 1, 35, 'DKS release actuation');
    const off = newProtocol ? 12 : 10;
    const p = newProtocol
      ? padded([0, CMD.SET_DATA, 0, 22, 0, 4, dks.id, 3, dks.first, DKS_BOTTOM_OUT, DKS_BOTTOM_OUT, dks.last], 63)
      : padded([0, CMD.SET_LEGACY, 0, 22, dks.id, 3, dks.first, DKS_BOTTOM_OUT, DKS_BOTTOM_OUT, dks.last], 63);
    dks.bindings.forEach((b, i) => {
      if (!b.vk) return;
      assertByte(b.vk, `DKS binding ${i + 1}`);
      const [lo, hi] = dksMask(b.stages);
      p[off + 4 * i] = lo;
      p[off + 4 * i + 1] = hi;
      p[off + 4 * i + 2] = b.vk;
      p[off + 4 * i + 3] = 0;
    });
    return [frame(p)];
  }

  // mt = { id, holdVk, tapVk, holdMs (10..1000) }, make/brk of the physical key in 0.1 mm
  function setModTap(mt, make, brk, newProtocol) {
    assertRange(mt.id, 0, MAX_ADVANCED - 1, 'advanced key id');
    assertRange(mt.holdMs, 10, 1000, 'hold duration');
    assertRange(make, 1, 40, 'actuation');
    assertRange(brk, 1, 40, 'release');
    if (!mt.holdVk && !mt.tapVk) return []; // official tool sends nothing in that case
    const off = newProtocol ? 8 : 6;
    const p = newProtocol
      ? padded([0, CMD.SET_DATA, 0, 22, 16, 4, mt.id, 0], 63)
      : padded([0, CMD.SET_LEGACY, 0, 22, mt.id, 0], 63);
    p[off] = make;
    p[off + 1] = brk;
    p[off + 2] = mt.holdMs & 255;
    p[off + 3] = (mt.holdMs >> 8) & 255;
    if (mt.holdVk) p[off + 4] = assertByte(mt.holdVk, 'hold key');
    if (mt.tapVk) p[off + 6] = assertByte(mt.tapVk, 'tap key');
    return [frame(p)];
  }

  // ------------------------------------------------------------------ SOCD
  // socd = { type: 'RS'|'ST', a, b (key indices), priority 0..3, fullPressAlt }
  function setSocd(socd) {
    assertRange(socd.a, 0, KEY_COUNT - 1, 'SOCD key 1');
    assertRange(socd.b, 0, KEY_COUNT - 1, 'SOCD key 2');
    if (socd.a === socd.b) throw new RangeError('SOCD keys must differ');
    const p = padded([0, CMD.SET_LEGACY, 0, 10, 0, 0, 0], 63);
    if (socd.type === 'RS') {
      p[7] = SOCD_MODE.RS;
    } else if (socd.type === 'ST') {
      assertRange(socd.priority, 0, 3, 'SOCD priority');
      p[7] = SOCD_MODE.ST;
      // The official tool clears bit 7 when "alternative fully pressed behaviour" is ON.
      p[9] = ((socd.fullPressAlt ? 0 : 1) << 7) | socd.priority;
    } else throw new RangeError('SOCD type must be RS or ST');
    p[10] = socd.a;
    p[11] = socd.b;
    return [frame(p)];
  }
  // Clears both SOCD slots (exactly what the official "reset" sends).
  function clearSocd() {
    return [SOCD_MODE.RS, SOCD_MODE.ST].map((mode) => frame(padded([0, CMD.SET_LEGACY, 0, 10, 0, 0, 0, mode, 0, 0, 255, 255], 63)));
  }

  // ---------------------------------------------------------------- macros
  const EXEC_HOLD = 254; // repeat while held
  const EXEC_TOGGLE = 255; // press to start, press again to stop
  // macro = { id, name, mode: 'hold'|'toggle'|'count', count 1..253, steps: [{vk, down, delay(ms)}] }
  function macroBlob(m) {
    assertRange(m.id, 0, MAX_MACROS - 1, 'macro id');
    if (m.steps.length > MAX_MACRO_STEPS) throw new RangeError(`a macro can have at most ${MAX_MACRO_STEPS} steps`);
    const d = zeros(216);
    d[0] = m.id;
    const nameBytes = new TextEncoder().encode(m.name || '');
    if (nameBytes.length > 32) throw new RangeError('macro name too long');
    nameBytes.forEach((b, i) => (d[3 + i] = b));
    if (m.mode === 'hold') d[35] = EXEC_HOLD;
    else if (m.mode === 'toggle') d[35] = EXEC_TOGGLE;
    else d[35] = assertRange(m.count, 1, 253, 'repeat count');
    const generic = { 16: 160, 17: 162, 18: 164 }; // Shift/Ctrl/Alt -> left variants
    m.steps.forEach((s, i) => {
      assertByte(s.vk, `macro step ${i + 1} key`);
      const delay = Math.round(s.delay / 5);
      assertRange(delay, 0, 255, `macro step ${i + 1} delay (x5ms)`);
      d[36 + 3 * i] = generic[s.vk] || s.vk;
      d[37 + 3 * i] = delay;
      d[38 + 3 * i] = s.down ? 128 : 0;
    });
    const len = 35 + 3 * m.steps.length;
    d[1] = len & 255;
    d[2] = (len >> 8) & 255;
    return d;
  }
  function setMacro(m, newProtocol) {
    const d = macroBlob(m);
    const size = newProtocol ? 57 : 58;
    const frames = [];
    for (let c = 0; c * size < d.length; c++) {
      const part = d.slice(c * size, c * size + size);
      const head = newProtocol ? [0, CMD.SET_DATA, 0, part.length + 1, 0x40 | c, 1] : [0, CMD.SET_DATA, 0, part.length + 1, 0x40 | c];
      frames.push(frame([...head, ...part]));
    }
    return frames;
  }
  function deleteMacro(id) {
    assertRange(id, 0, MAX_MACROS - 1, 'macro id');
    const frames = [];
    for (let t = 0; t < 4; t++) {
      const n = t < 3 ? 58 : 42;
      const p = [0, CMD.SET_DATA, 0, n + 1, 0x40 | t];
      for (let a = 0; a < 58; a++) p.push(a < n ? (t === 0 && a === 0 ? id : 255) : 0);
      frames.push(frame(p));
    }
    return frames;
  }

  // -------------------------------------------------------------- decoding
  function commandOf(data) {
    let i = 1;
    if (!KNOWN_RX.has(data[1]) && KNOWN_RX.has(data[0])) i = 0;
    return data[i];
  }
  const hex2 = (v) => v.toString(16).padStart(2, '0').toUpperCase().slice(-2);
  function parseVersion(d) {
    const dev = (d[4] & 255) | ((d[5] & 15) << 4);
    const hall = (d[10] & 255) | ((d[11] & 15) << 4);
    return { device: dev, protocol: d[9], hall, label: 'V' + hex2(dev), protocolLabel: 'V' + hex2(d[9]), hallLabel: 'V' + hex2(hall) };
  }
  const isNewProtocol = (version) => version >= NEW_PROTOCOL_MIN_VERSION;
  function parseRgb(d) {
    const colors = [];
    for (let i = 0; i < 7; i++) {
      const r = d[9 + 3 * i], g = d[10 + 3 * i], b = d[11 + 3 * i];
      colors.push('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
    }
    const speed = d[7] <= 3 ? 3 - d[7] : 2;
    return { on: d[4] ? 1 : 0, effect: d[5], brightness: Math.min(9, d[6]), speed, colorIndex: Math.min(6, d[8]), colors };
  }

  // Reassembles a macro from the 4 response frames of getMacro(id).
  // Response layout (chunk 0): [0,0x61,0,len,0x40, len_lo, len_hi, name[32], exec, steps...]
  function parseMacroFrames(id, frames) {
    const first = frames[0];
    if (!first || first[4] !== 0x40) throw new Error('macro response incomplete');
    if (first[5] === 255) return null; // empty slot
    const bytes = [];
    frames.forEach((f, c) => {
      const len = f[3];
      for (let i = 0; i < len - 1; i++) bytes.push(f[5 + i]);
      if (c === 0 && f[4] !== 0x40) throw new Error('macro chunk order');
    });
    // bytes[0..1] = length, [2..33] = name, [34] = exec, [35..] = steps
    const total = bytes[0] | (bytes[1] << 8);
    const nSteps = Math.floor((total - 35) / 3);
    if (!(nSteps >= 0 && nSteps <= MAX_MACRO_STEPS)) return { id, name: '', mode: 'hold', count: 1, steps: [], corrupt: true };
    const nameBytes = bytes.slice(2, 34);
    const end = nameBytes.indexOf(0);
    let name = '';
    try { name = new TextDecoder().decode(new Uint8Array(end < 0 ? nameBytes : nameBytes.slice(0, end))); } catch (e) { /* keep empty */ }
    const exec = bytes[34];
    const steps = [];
    for (let i = 0; i < nSteps; i++) {
      const o = 35 + 3 * i;
      if (o + 2 >= bytes.length) break;
      steps.push({ vk: bytes[o], delay: bytes[o + 1] * 5, down: bytes[o + 2] === 128 });
    }
    return {
      id, name, steps,
      mode: exec === EXEC_HOLD ? 'hold' : exec === EXEC_TOGGLE ? 'toggle' : 'count',
      count: exec === EXEC_HOLD || exec === EXEC_TOGGLE ? 1 : exec,
    };
  }

  const toHex = (f) => Array.from(f, (b) => b.toString(16).padStart(2, '0')).join(' ');

  B.protocol = {
    REPORT_SIZE, VENDOR_ID, PRODUCT_ID, USAGE_PAGE, CMD, KEY_COUNT, MAX_MACROS, MAX_MACRO_STEPS, MAX_ADVANCED,
    NEW_PROTOCOL_MIN_VERSION, TESTED_MAX_VERSION, DKS_MASKS,
    frame, verifyFrame, getVersion, getRgb, getMacro, setRgb, setBaseKeymap, setLayerKey, setTriggers,
    dksMask, setDks, setModTap, setSocd, clearSocd, setMacro, deleteMacro, macroBlob,
    commandOf, parseVersion, isNewProtocol, parseRgb, parseMacroFrames, toHex,
  };
})(typeof window !== 'undefined' ? window : globalThis);
