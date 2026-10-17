// Every frame we build must be byte-identical to what the official tool sends
// for the same settings. tests/fixtures/official-frames.json holds frames
// recorded from the official configurator (boog75.meletrix.com) for a fixed
// set of inputs; the decoders must also invert the encoders.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, rng, bytes } = require('./helpers');
const B = load();
const P = B.protocol;
const FX = require('./fixtures/official-frames.json');

const toHex = (f) => Buffer.from(f).toString('hex').replace(/(00)+$/, '');
const same = (mine, expected, what) => {
  assert.equal(mine.length, expected.length, `${what}: frame count`);
  mine.forEach((f, i) => {
    assert.equal(f.length, 64, `${what}: frame ${i} length`);
    assert.equal(toHex(f), expected[i], `${what}: frame ${i}\nmine:     ${toHex(f)}\nexpected: ${expected[i]}`);
  });
};
const R = rng();
const hex = () => '#' + [0, 0, 0].map(() => R.int(256).toString(16).padStart(2, '0')).join('');
const vks = B.keycodes.entries.map((e) => e.vk).filter((v) => v);

test('frame(): checksum follows payload, padding is zero, sum is 0x55', () => {
  for (let n = 0; n < 200; n++) {
    const len = 1 + R.int(63);
    const payload = Array.from({ length: len }, () => R.int(256));
    const f = P.frame(payload);
    assert.equal(f.length, 64);
    assert.deepEqual(bytes(f.slice(0, len)), payload);
    const sum = payload.reduce((a, b) => a + b, 0) + f[len];
    assert.equal(sum & 0xff, 0x55);
    assert.ok(f.slice(len + 1).every((b) => b === 0));
    assert.ok(P.verifyFrame(f));
  }
  assert.throws(() => P.frame(new Array(64).fill(0)), /too long/);
  assert.throws(() => P.frame([0, 256]), /invalid byte/);
  assert.throws(() => P.frame([0, -1]), /invalid byte/);
  assert.throws(() => P.frame([0, 1.5]), /invalid byte/);
});

test('fixtures cover every command type', () => {
  for (const k of ['rgb', 'keymap', 'layerKey', 'triggers', 'dks', 'modTap', 'socd', 'macro', 'macroDelete']) assert.ok(FX[k].length >= 30, k);
  assert.equal(FX.reads.macro.length, 40);
});

test('read requests match the official frames', () => {
  same(P.getVersion(), FX.reads.version, 'version');
  same(P.getRgb(), FX.reads.rgb, 'rgb read');
  FX.reads.macro.forEach(({ id, frames }) => same(P.getMacro(id), frames, 'macro read ' + id));
  assert.throws(() => P.getMacro(40));
});

test('setRgb matches the official frames', () => {
  FX.rgb.forEach(({ input, frames }, i) => same(P.setRgb(input), frames, 'rgb #' + i));
});

test('base keymap matches the official frames', () => {
  FX.keymap.forEach(({ input, frames }, i) => same(P.setBaseKeymap(input), frames, 'keymap #' + i));
  assert.throws(() => P.setBaseKeymap(new Array(80).fill({ vk: 4, ext: 0 })));
});

test('Fn layer keys match the official frames', () => {
  FX.layerKey.forEach(({ input, frames }, i) => same(P.setLayerKey(input.layer, input.idx, { vk: input.vk, ext: input.ext }), frames, 'layer key #' + i));
});

test('trigger table matches the official frames', () => {
  FX.triggers.forEach(({ input, frames }, i) => same(P.setTriggers(input), frames, 'triggers #' + i));
});

test('DKS matches the official frames (current and legacy firmware)', () => {
  FX.dks.forEach(({ input, current, legacy }, i) => {
    same(P.setDks(input, true), current, 'dks current #' + i);
    same(P.setDks(input, false), legacy, 'dks legacy #' + i);
  });
});

test('DKS stage masks', () => {
  const st = (pairs) => [0, 1, 2, 3].map((s) => (pairs[s] === undefined ? { on: false, span: 0 } : { on: true, span: pairs[s] }));
  assert.deepEqual(P.dksMask(st({})), [0, 0]);
  assert.deepEqual(P.dksMask(st({ 0: 3 })), [0xff, 0]);
  assert.deepEqual(P.dksMask(st({ 3: 0 })), [0, 2]);
  assert.deepEqual(P.dksMask(st({ 0: 0, 1: 0, 2: 0, 3: 0 })), [0x49, 0x02]);
  assert.throws(() => P.dksMask(st({ 1: 3 })), /invalid hold span/);
  assert.throws(() => P.setDks({ id: 0, first: 0, last: 10, bindings: [] }, true));
  assert.throws(() => P.setDks({ id: 0, first: 10, last: 36, bindings: [] }, true));
});

test('Mod-Tap matches the official frames (current and legacy firmware)', () => {
  FX.modTap.forEach(({ input, current, legacy }, i) => {
    const mt = { id: input.id, holdVk: input.holdVk, tapVk: input.tapVk, holdMs: input.holdMs };
    same(P.setModTap(mt, input.make, input.brk, true), current, 'mt current #' + i);
    same(P.setModTap(mt, input.make, input.brk, false), legacy, 'mt legacy #' + i);
  });
});
test('SOCD matches the official frames', () => {
  FX.socd.forEach(({ input, frames }, i) => same(P.setSocd(input), frames, 'socd #' + i));
  same(P.clearSocd(), FX.socdClear, 'socd reset');
  assert.throws(() => P.setSocd({ type: 'XX', a: 1, b: 2 }));
  assert.throws(() => P.setSocd({ type: 'ST', a: 1, b: 2, priority: 4 }));
});
test('macros match the official frames (current and legacy firmware)', () => {
  FX.macro.forEach(({ input, current, legacy }, i) => {
    same(P.setMacro(input, true), current, 'macro current #' + i);
    same(P.setMacro(input, false), legacy, 'macro legacy #' + i);
  });
  FX.macroDelete.forEach(({ id, frames }) => same(P.deleteMacro(id), frames, 'macro delete ' + id));
});
test('encoders reject out-of-range input', () => {
  const colors = B.profile.DEFAULT_COLORS;
  assert.throws(() => P.setLayerKey(0, 0, { vk: 4 }));
  assert.throws(() => P.setLayerKey(4, 0, { vk: 4 }));
  assert.throws(() => P.setLayerKey(1, 81, { vk: 4 }));
  assert.throws(() => P.setLayerKey(1, 0, { vk: 300 }));
  assert.throws(() => P.setTriggers(Array(81).fill({ make: 0, brk: 10 })));
  assert.throws(() => P.setTriggers(Array(81).fill({ make: 41, brk: 10 })));
  assert.throws(() => P.setTriggers(Array(81).fill({ make: 10.5, brk: 10 })));
  assert.throws(() => P.setRgb({ on: 1, effect: 1, brightness: 10, speed: 1, colorIndex: 0, colors }));
  assert.throws(() => P.setRgb({ on: 1, effect: 9, brightness: 1, speed: 1, colorIndex: 0, colors }));
  assert.throws(() => P.setRgb({ on: 1, effect: 1, brightness: 1, speed: 1, colorIndex: 0, colors: ['#fff'] }));
  assert.throws(() => P.setRgb({ on: 1, effect: 1, brightness: 1, speed: 1, colorIndex: 0, colors: Array(7).fill('red') }));
  assert.throws(() => P.setSocd({ type: 'RS', a: 3, b: 3 }));
  assert.throws(() => P.setMacro({ id: 40, name: '', mode: 'hold', steps: [] }, true));
  assert.throws(() => P.setMacro({ id: 1, name: '', mode: 'count', count: 0, steps: [] }, true));
  assert.throws(() => P.setMacro({ id: 1, name: 'x'.repeat(33), mode: 'hold', steps: [] }, true));
  assert.throws(() => P.setMacro({ id: 1, name: '', mode: 'hold', steps: Array(61).fill({ vk: 65, down: true, delay: 0 }) }, true));
  assert.throws(() => P.setMacro({ id: 1, name: '', mode: 'count', count: 1, steps: [{ vk: 65, down: true, delay: 2000 }] }, true));
  assert.throws(() => P.setModTap({ id: 1, holdVk: 65, tapVk: 66, holdMs: 5 }, 10, 10, true));
  assert.throws(() => P.setModTap({ id: 20, holdVk: 65, tapVk: 66, holdMs: 200 }, 10, 10, true));
  assert.deepEqual(P.setModTap({ id: 1, holdVk: 0, tapVk: 0, holdMs: 200 }, 10, 10, true), []);
});

test('commandOf follows the official offset rule', () => {
  const f = new Uint8Array(64);
  f[1] = 0x19; assert.equal(P.commandOf(f), 0x19);
  const g = new Uint8Array(64); g[0] = 0x02; g[1] = 0x77; assert.equal(P.commandOf(g), 0x02);
  const z = new Uint8Array(64); z[1] = 0x77; assert.equal(P.commandOf(z), 0x77);
});

test('parseVersion / isNewProtocol', () => {
  const v = new Uint8Array(64); v[1] = 2; v[4] = 0x30; v[9] = 0x05; v[10] = 0x12;
  const pv = P.parseVersion(v);
  assert.equal(pv.label, 'V30'); assert.equal(pv.protocolLabel, 'V05'); assert.equal(pv.hallLabel, 'V12');
  assert.ok(P.isNewProtocol(0x28) && P.isNewProtocol(0x30) && P.isNewProtocol(0x31));
  assert.ok(!P.isNewProtocol(0x27) && !P.isNewProtocol(0x22));
  const old = new Uint8Array(64); old[4] = 0x22; assert.equal(P.parseVersion(old).label, 'V22');
});

test('parseRgb inverts setRgb', () => {
  for (let n = 0; n < 100; n++) {
    const rgb = { on: R.int(2), effect: R.int(9), brightness: R.int(10), speed: R.int(4), colorIndex: R.int(7), colors: Array.from({ length: 7 }, hex) };
    const f = P.setRgb(rgb)[0];
    f[1] = 0x19;
    assert.deepEqual(P.parseRgb(f), rgb);
  }
  const weird = new Uint8Array(64); weird[6] = 50; weird[7] = 9; weird[8] = 99;
  const r = P.parseRgb(weird);
  assert.equal(r.brightness, 9); assert.equal(r.speed, 2); assert.equal(r.colorIndex, 6);
});

function macroReply(m) {
  const blob = P.macroBlob(m).slice(1); // the reply omits the id byte
  return [0, 1, 2, 3].map((c) => {
    const part = blob.slice(c * 58, c * 58 + 58);
    const f = new Uint8Array(64); f[1] = 0x61; f[3] = part.length + 1; f[4] = 0x40 | c; part.forEach((b, i) => (f[5 + i] = b));
    return f;
  });
}

test('parseMacroFrames inverts macroBlob', () => {
  for (let n = 0; n < 200; n++) {
    const steps = Array.from({ length: R.int(61) }, () => ({ vk: R.pick(vks), delay: 5 * R.int(201), down: R.bool() }));
    const modeN = R.int(3);
    const m = { id: R.int(40), name: R.pick(['', 'Hello', 'Ünï']), steps, mode: ['hold', 'toggle', 'count'][modeN], count: modeN === 2 ? 1 + R.int(253) : 1 };
    assert.deepEqual(P.parseMacroFrames(m.id, macroReply(m)), m);
  }
  const empty = new Uint8Array(64); empty[1] = 0x61; empty[4] = 0x40; empty[5] = 255;
  assert.equal(P.parseMacroFrames(0, [empty]), null);
  const bad = macroReply({ id: 1, name: 'x', steps: [], mode: 'hold', count: 1 });
  bad[0][5] = 2; // length below the header size
  assert.equal(P.parseMacroFrames(1, bad).corrupt, true);
  assert.throws(() => P.parseMacroFrames(1, []), /incomplete/);
});
