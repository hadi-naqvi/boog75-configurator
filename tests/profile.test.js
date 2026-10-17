'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, rng } = require('./helpers');
const B = load();
const Pr = B.profile, P = B.protocol, L = B.layout, VK = B.keycodes.VK;

const applyAll = (plan, known = {}) => { plan.forEach((s) => s.apply(known)); return known; };
const labels = (plan) => plan.map((s) => s.label);
const frameCount = (plan) => plan.reduce((n, s) => n + s.frames.length, 0);

test('default profile is valid and stable under normalize', () => {
  const d = Pr.defaultProfile('X');
  assert.deepEqual(Pr.normalize(d), d);
  assert.equal(d.layers.length, 4);
  d.layers.forEach((l) => assert.equal(l.length, 81));
  assert.equal(d.keys.length, 81);
  assert.ok(d.keys.every((k) => k.make === 10 && k.brk === 10 && !k.tgl));
});

test('normalize repairs garbage without throwing', () => {
  const inputs = [null, undefined, 42, 'x', [], {}, { layers: 'no' }, { layers: [[], [], []] }, { keys: [1, 2] },
    { rgb: { effect: 99, brightness: -4, speed: 'fast', colorIndex: 7, colors: ['nope'] } },
    { macros: [{ id: 'a' }, { id: 1, steps: 'x' }, { id: 1 }, { id: 99 }] },
    { advanced: [{ id: 0, type: 'DKS', key: 5 }, { id: 0, type: 'MT', key: 6 }, { id: 1, type: 'MT', key: 5 }, { id: 2, type: 'XX', key: 7 }, { id: 3, type: 'MT', key: 99 }] },
    { socd: { type: 'RS', a: 1, b: 1 } }, { socd: { type: 'ST', a: 1, b: 200 } }, { name: 'n'.repeat(100) }];
  for (const inp of inputs) {
    const p = Pr.normalize(inp);
    // Whatever came in, every encoder must accept the result.
    assert.doesNotThrow(() => Pr.planSync(p, null, true), JSON.stringify(inp));
    assert.doesNotThrow(() => Pr.planSync(p, null, false), JSON.stringify(inp));
  }
  const p = Pr.normalize(inputs[9]);
  assert.equal(p.rgb.effect, 8); assert.equal(p.rgb.brightness, 0); assert.equal(p.rgb.speed, 2); assert.equal(p.rgb.colorIndex, 6);
  assert.equal(p.rgb.colors[0], '#ffffff');
  const m = Pr.normalize(inputs[10]).macros;
  assert.deepEqual(m.map((x) => x.id), [1]);
  const a = Pr.normalize(inputs[11]).advanced;
  assert.deepEqual(a.map((x) => [x.id, x.type, x.key]), [[0, 'DKS', 5]]);
  assert.equal(Pr.normalize(inputs[12]).socd, null);
  assert.equal(Pr.normalize(inputs[14]).name.length, 40);
});

test('normalize keeps keymap consistent with advanced keys and macros', () => {
  const p = Pr.defaultProfile();
  p.advanced.push({ id: 3, type: 'MT', key: 45, holdVk: 162, tapVk: 27, holdMs: 200, origVk: 20 });
  p.macros.push({ id: 2, name: 'm', mode: 'count', count: 1, steps: [{ vk: 65, down: true, delay: 12 }] });
  p.layers[1][5] = { vk: VK.MACRO, ext: 2 };
  p.layers[2][6] = { vk: VK.MACRO, ext: 9 }; // macro 9 doesn't exist
  p.layers[0][10] = { vk: VK.ADVANCED_KEY, ext: 7 }; // no such advanced key
  p.layers[1][11] = { vk: VK.ADVANCED_KEY, ext: 3 }; // advanced keys only live on layer 0
  p.layers[0][12] = { vk: 65, ext: 9 }; // ext is meaningless for normal keys
  const n = Pr.normalize(p);
  assert.deepEqual(n.layers[0][45], { vk: VK.ADVANCED_KEY, ext: 3 });
  assert.deepEqual(n.layers[1][5], { vk: VK.MACRO, ext: 2 });
  assert.deepEqual(n.layers[2][6], { vk: L.defaultLayers[2][6], ext: 0 });
  assert.deepEqual(n.layers[0][10], { vk: L.defaultLayers[0][10], ext: 0 });
  assert.deepEqual(n.layers[1][11], { vk: L.defaultLayers[1][11], ext: 0 });
  assert.deepEqual(n.layers[0][12], { vk: 65, ext: 0 });
  assert.equal(n.macros[0].steps[0].delay, 10); // rounded to 5 ms
  assert.equal(n.advanced[0].origVk, 20);
});

test('first sync from unknown state writes everything, in a safe order', () => {
  const p = Pr.defaultProfile();
  p.macros.push({ id: 0, name: 'a', mode: 'hold', count: 1, steps: [] });
  p.advanced.push({ id: 0, type: 'DKS', key: 45, first: 16, last: 16, bindings: [{ vk: 65, stages: [{ on: true, span: 3 }, {}, {}, {}] }] });
  p.socd = { type: 'RS', a: 46, b: 48, priority: 0, fullPressAlt: true };
  const n = Pr.normalize(p);
  const plan = Pr.planSync(n, null, true);
  const sections = plan.map((s) => s.section);
  // macros and advanced definitions go out before the keymap that references them
  assert.ok(sections.indexOf('macros') < sections.indexOf('keymap'));
  assert.ok(sections.indexOf('advanced') < sections.indexOf('keymap'));
  assert.deepEqual(labels(plan).slice(-3), ['Actuation & rapid trigger', 'Lighting', 'Rappy Snappy']);
  // 4 macro + 1 DKS + 3 base + 243 Fn + 6 trigger + 1 rgb + 3 socd
  assert.equal(frameCount(plan), 4 + 1 + 3 + 243 + 6 + 1 + 3);
  plan.filter((s) => s.section === 'keymap').forEach((s) => assert.ok(Number.isInteger(s.layer)));
  const known = applyAll(plan);
  assert.equal(Pr.planSync(n, known, true).length, 0, 'nothing pending after a full sync');
});

test('incremental sync sends only what changed', () => {
  const n = Pr.normalize(Pr.defaultProfile());
  const known = applyAll(Pr.planSync(n, null, true));
  const diff = (fn) => { const c = Pr.clone(n); fn(c); return Pr.planSync(Pr.normalize(c), known, true); };

  let d = diff((c) => { c.layers[2][10] = { vk: 65, ext: 0 }; c.layers[2][11] = { vk: 66, ext: 0 }; });
  assert.deepEqual(labels(d), ['Fn + Shift layer (2 keys)']);
  assert.equal(d[0].layer, 2);
  assert.equal(frameCount(d), 2);

  d = diff((c) => { c.layers[0][0] = { vk: 20, ext: 0 }; });
  assert.deepEqual(labels(d), ['Base layer keymap']);
  assert.equal(frameCount(d), 3);

  d = diff((c) => { c.keys[5].brk = 3; });
  assert.deepEqual(labels(d), ['Actuation & rapid trigger']);

  d = diff((c) => { c.rgb.colors[3] = '#123456'; });
  assert.deepEqual(labels(d), ['Lighting']);

  d = diff((c) => { c.socd = { type: 'ST', a: 1, b: 2, priority: 1, fullPressAlt: false }; });
  assert.deepEqual(labels(d), ['Snappy Tappy (SOCD)']);
  assert.equal(frameCount(d), 3); // clear both slots + set
});

test('SOCD changes always clear both slots first', () => {
  const n = Pr.normalize(Object.assign(Pr.defaultProfile(), { socd: { type: 'RS', a: 1, b: 2 } }));
  const known = applyAll(Pr.planSync(n, null, true));
  n.socd = null;
  const d = Pr.planSync(n, known, true);
  assert.deepEqual(labels(d), ['Clear SOCD']);
  assert.deepEqual(d[0].frames.map((f) => f[7]), [2, 1]);
  assert.ok(d[0].frames.every((f) => f[10] === 255 && f[11] === 255));
});

test('macro diffs: write changed, delete removed (only once the keyboard state is known)', () => {
  const m = (id, name) => ({ id, name, mode: 'count', count: 1, steps: [] });
  const n = Pr.normalize(Object.assign(Pr.defaultProfile(), { macros: [m(0, 'a'), m(1, 'b')] }));
  const known = applyAll(Pr.planSync(n, null, true));
  n.macros = [m(0, 'a2')];
  const d = Pr.planSync(Pr.normalize(n), known, true);
  assert.deepEqual(labels(d), ['Macro 1 "a2"', 'Delete macro 2']);
  applyAll(d, known);
  assert.deepEqual(known.macros.map((x) => x.name), ['a2']);
  // Without knowledge of the keyboard's macros nothing gets deleted.
  const fresh = Pr.planSync(Pr.normalize(n), { layers: known.layers, keys: known.keys, rgb: known.rgb, socd: known.socd, advanced: known.advanced }, true);
  assert.deepEqual(labels(fresh), ['Macro 1 "a2"']);
});

test('Mod-Tap is resent when its key actuation changes; DKS is not', () => {
  const p = Pr.defaultProfile();
  p.advanced.push({ id: 0, type: 'MT', key: 45, holdVk: 162, tapVk: 27, holdMs: 200 });
  p.advanced.push({ id: 1, type: 'DKS', key: 30, first: 10, last: 10, bindings: [] });
  const n = Pr.normalize(p);
  const known = applyAll(Pr.planSync(n, null, true));
  n.keys[45].make = 20;
  n.keys[30].make = 20;
  const d = Pr.planSync(n, known, true);
  assert.deepEqual(labels(d), ['Mod-tap on Caps Lock', 'Actuation & rapid trigger']);
  assert.equal(d[0].frames[0][8], 20);
});

test('legacy firmware plans use the legacy commands', () => {
  const p = Pr.defaultProfile();
  p.advanced.push({ id: 0, type: 'MT', key: 45, holdVk: 162, tapVk: 27, holdMs: 200 });
  p.macros.push({ id: 0, name: 'x', mode: 'hold', count: 1, steps: [] });
  const plan = Pr.planSync(Pr.normalize(p), null, false);
  const mt = plan.find((s) => s.section === 'advanced');
  assert.equal(mt.frames[0][1], P.CMD.SET_LEGACY);
  const macro = plan.find((s) => s.section === 'macros');
  assert.equal(macro.frames[0][5], 0); // no extra flag byte; data starts with the id
});

test('removing an advanced key drops it from the known state after the keymap is written', () => {
  const p = Pr.defaultProfile();
  p.advanced.push({ id: 4, type: 'MT', key: 45, holdVk: 162, tapVk: 27, holdMs: 200 });
  const n = Pr.normalize(p);
  const known = applyAll(Pr.planSync(n, null, true));
  assert.equal(known.advanced.length, 1);
  n.advanced = [];
  n.layers[0][45] = { vk: 20, ext: 0 };
  const d = Pr.planSync(Pr.normalize(n), known, true);
  assert.deepEqual(labels(d), ['Base layer keymap']);
  applyAll(d, known);
  assert.equal(known.advanced.length, 0);
});

test('random profiles always produce valid frames and converge', () => {
  const R = rng(777);
  const vks = B.keycodes.entries.map((e) => e.vk);
  for (let n = 0; n < 60; n++) {
    const p = Pr.defaultProfile();
    for (let k = 0; k < 30; k++) p.layers[R.int(4)][R.int(81)] = { vk: R.pick(vks), ext: 0 };
    p.keys = p.keys.map(() => ({ make: 1 + R.int(40), brk: 1 + R.int(40), tgl: R.int(6) === 0 }));
    for (let m = 0; m < R.int(5); m++) p.macros.push({ id: R.int(40), name: 'm' + m, mode: R.pick(['hold', 'toggle', 'count']), count: 1 + R.int(253), steps: Array.from({ length: R.int(20) }, () => ({ vk: R.pick(vks.filter(Boolean)), down: R.bool(), delay: R.int(1001) })) });
    for (let a = 0; a < R.int(5); a++) p.advanced.push(R.bool() ? { id: a, type: 'MT', key: R.int(81), holdVk: R.pick(vks), tapVk: R.pick(vks), holdMs: 10 + R.int(990) } : { id: a, type: 'DKS', key: R.int(81), first: 1 + R.int(35), last: 1 + R.int(35), bindings: [0, 1, 2, 3].map(() => ({ vk: R.pick(vks), stages: [0, 1, 2, 3].map((s) => ({ on: R.bool(), span: R.int(4 - s) })) })) });
    if (R.bool()) p.socd = { type: R.pick(['RS', 'ST']), a: R.int(40), b: 40 + R.int(41), priority: R.int(4), fullPressAlt: R.bool() };
    const np = Pr.normalize(p);
    for (const proto of [true, false]) {
      const plan = Pr.planSync(np, null, proto);
      plan.forEach((s) => s.frames.forEach((f) => { assert.equal(f.length, 64); assert.ok(P.verifyFrame(f)); }));
      assert.equal(Pr.planSync(np, applyAll(plan), proto).length, 0);
    }
  }
});

test('official export import', () => {
  const j = {
    keyMap0: [[{ idx: 0, vkCode: 27, rapidTrigger: { make: 0.4, break: 0.3 }, triggerMode: 2 }, { idx: 1, vkCode: 218, isAdvancedKey: true, advancedKeyId: 1, rapidTrigger: { make: 1, break: 1 }, triggerMode: 4 }]],
    keyMap1: [[{ idx: 3, vkCode: 152, isMacro: true, macroId: 0 }, { idx: 4, vkCode: 'garbage' }]],
    rgbEffect: { lightOn: 1, lightEffect: 3, lightBrightness: 5, lightSpeed: 1, currentLedColorIndex: 2, lightColor0: { hex: '#123456' } },
    macroList: [{ id: 0, title: 'Hi there long name', executeType: 2, executeCount: 2, data: [{ vkCode: 72, spanTime: 10, keyState: 1 }, { vkCode: 72, spanTime: 10, keyState: 0 }] }],
    advancedKeyList: [
      { id: 1, type: 'MT', keyIndex: 1, vkCode: 112, pressTime: 250, mt: [{ vkCode: 162 }, { vkCode: 27 }] },
      { id: 2, type: 'DKS', keyIndex: 5, vkCode: 116, fitstTriggerPos: 2.1, lastTriggerPos: 1.4, dks: [{ vkCode: 65, data: [{ visible: true, dataType: 3 }, { visible: false }, { visible: false }, { visible: true, dataType: 0 }] }] },
      { id: 3, type: 'ST', st: [{ keyIndex: 47 }, { keyIndex: 49 }], socdType: 3, fullPress: 1 },
      { id: 4, type: 'TGL', keyIndex: 9 },
    ],
  };
  const p = Pr.parseImport(JSON.stringify(j), 'x');
  assert.deepEqual(p.keys[0], { make: 4, brk: 3, tgl: false });
  assert.equal(p.keys[1].tgl, true);
  assert.deepEqual(p.layers[0][1], { vk: 218, ext: 1 });
  assert.deepEqual(p.layers[0][5], { vk: 218, ext: 2 });
  assert.deepEqual(p.layers[1][3], { vk: 152, ext: 0 });
  assert.deepEqual(p.layers[1][4], { vk: L.defaultLayers[1][4], ext: 0 });
  assert.equal(p.rgb.colors[0], '#123456');
  assert.equal(p.rgb.effect, 3);
  assert.equal(p.macros[0].name, 'Hi there l');
  assert.equal(p.macros[0].mode, 'count');
  assert.equal(p.macros[0].steps.length, 2);
  const mt = p.advanced.find((a) => a.type === 'MT');
  assert.deepEqual([mt.holdVk, mt.tapVk, mt.holdMs, mt.origVk], [162, 27, 250, 112]);
  const dks = p.advanced.find((a) => a.type === 'DKS');
  assert.deepEqual([dks.first, dks.last], [21, 14]);
  assert.deepEqual(dks.bindings[0].stages, [{ on: true, span: 3 }, { on: false, span: 0 }, { on: false, span: 0 }, { on: true, span: 0 }]);
  assert.deepEqual(p.socd, { type: 'ST', a: 47, b: 49, priority: 3, fullPressAlt: false });
  assert.doesNotThrow(() => Pr.planSync(p, null, true));
});

test('own export round-trips; bad files are rejected', () => {
  const p = Pr.normalize(Object.assign(Pr.defaultProfile('Mine'), { macros: [{ id: 5, name: 'z', mode: 'toggle', count: 1, steps: [{ vk: 65, down: true, delay: 5 }] }] }));
  assert.deepEqual(Pr.parseImport(JSON.stringify(p)), p);
  assert.throws(() => Pr.parseImport('{"hello":1}'), /Not a BOOG75 profile/);
  assert.throws(() => Pr.parseImport('not json'), SyntaxError);
  assert.throws(() => Pr.parseImport('null'), /Not a BOOG75 profile/);
});
