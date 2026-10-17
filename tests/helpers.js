// Loads the browser modules into this Node process (they attach to globalThis.Boog).
'use strict';
const path = require('path');

function load(...extra) {
  for (const f of ['keycodes', 'layout', 'protocol', 'profile', ...extra]) require(path.join(__dirname, '..', 'js', f + '.js'));
  return globalThis.Boog;
}

// Deterministic PRNG so failures are reproducible.
function rng(seed = 12345) {
  let s = seed;
  const next = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
  return { int: next, pick: (arr) => arr[next(arr.length)], bool: () => next(2) === 1 };
}

const bytes = (f) => Array.from(f);

module.exports = { load, rng, bytes };
