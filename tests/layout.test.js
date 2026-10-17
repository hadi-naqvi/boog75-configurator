'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');
const B = load();
const L = B.layout, K = B.keycodes;

test('81 keys, unique indices 0..80, no overlaps, inside the case', () => {
  const keys = L.keys.filter(Boolean);
  assert.equal(keys.length, 81);
  assert.deepEqual(keys.map((k) => k.idx).sort((a, b) => a - b), Array.from({ length: 81 }, (_, i) => i));
  for (const a of keys) {
    assert.ok(a.x >= 0 && a.x + a.w <= L.width + 1e-9, `key ${a.idx} within width`);
    assert.ok(a.y >= 0 && a.y + 1 <= L.height + 1e-9, `key ${a.idx} within height`);
    for (const b of keys) {
      if (a === b || a.y !== b.y) continue;
      assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9, `keys ${a.idx} and ${b.idx} overlap`);
    }
  }
  // Rows 1-3 and the arrow column line up at 16u.
  for (const idx of [14, 29, 44, 58]) assert.equal(L.keys[idx].x + L.keys[idx].w, 16);
  assert.equal(L.keys[71].x, L.keys[79].x, 'Up sits above Down');
});

test('factory layers match the official defaults', () => {
  const official0 = [27, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 36, 192, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 189, 187, 8, 46, 9, 81, 87, 69, 82, 84, 89, 85, 73, 79, 80, 219, 221, 220, 33, 20, 65, 83, 68, 70, 71, 72, 74, 75, 76, 186, 222, 13, 34, 160, 90, 88, 67, 86, 66, 78, 77, 188, 190, 191, 161, 38, 162, 91, 164, 32, 165, 245, 37, 40, 39];
  assert.deepEqual(L.defaultLayers[0], official0);
  const fn = L.defaultLayers[1];
  assert.deepEqual([fn[1], fn[2], fn[3], fn[4], fn[41], fn[42], fn[43], fn[71], fn[73], fn[78], fn[79], fn[80]], [243, 175, 174, 173, 149, 148, 199, 204, 250, 207, 205, 206]);
  assert.equal(L.defaultLayers[0][L.FN_KEY_INDEX], K.VK.FN);
  L.defaultLayers.forEach((layer) => { assert.equal(layer.length, 81); layer.forEach((vk) => assert.ok(K.byVk.has(vk), 'label for ' + vk)); });
});

test('keycode tables are consistent', () => {
  const vks = K.entries.map((e) => e.vk);
  assert.equal(new Set(vks).size, vks.length, 'no duplicate entries');
  K.entries.forEach((e) => { assert.ok(Number.isInteger(e.vk) && e.vk >= 0 && e.vk <= 255); assert.ok(e.name); });
  K.categories.forEach((c) => c.vks.forEach((vk) => assert.ok(K.byVk.has(vk), `${c.id}: ${vk} has a label`)));
  const inCats = new Set(K.categories.flatMap((c) => c.vks));
  K.entries.forEach((e) => assert.ok(inCats.has(e.vk), `${e.name} reachable from a category`));
  assert.ok(!K.byVk.has(K.VK.MACRO) && !K.byVk.has(K.VK.ADVANCED_KEY), 'macro/advanced codes are not directly assignable');
  Object.entries(K.codeToVk).forEach(([code, vk]) => assert.ok(K.byVk.has(vk), `${code} -> ${vk}`));
  assert.equal(K.label(0x99), '0x99');
  assert.match(K.name(0x99), /Unknown/);
});

test('every base-layer key can be selected by its physical KeyboardEvent.code', () => {
  const reachable = new Set(Object.values(K.codeToVk));
  const missing = L.defaultLayers[0].filter((vk) => !reachable.has(vk) && vk !== K.VK.FN);
  assert.deepEqual(missing, []);
});
