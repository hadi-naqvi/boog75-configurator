// Physical layout of the BOOG75 and the factory keymap for all four layers.
// Key indices (0..80) are the firmware's matrix positions, identical to the official tool.
(function (root) {
  'use strict';
  const B = (root.Boog = root.Boog || {});

  // Each row: [idx, width(u), gapBefore(u)]
  const rows = [
    [[0, 1], [1, 1, 0.25], [2, 1], [3, 1], [4, 1], [5, 1, 0.25], [6, 1], [7, 1], [8, 1], [9, 1, 0.25], [10, 1], [11, 1], [12, 1], [13, 1, 0.25], [14, 1]],
    [[15, 1], [16, 1], [17, 1], [18, 1], [19, 1], [20, 1], [21, 1], [22, 1], [23, 1], [24, 1], [25, 1], [26, 1], [27, 1], [28, 2], [29, 1]],
    [[30, 1.5], [31, 1], [32, 1], [33, 1], [34, 1], [35, 1], [36, 1], [37, 1], [38, 1], [39, 1], [40, 1], [41, 1], [42, 1], [43, 1.5], [44, 1]],
    [[45, 1.75], [46, 1], [47, 1], [48, 1], [49, 1], [50, 1], [51, 1], [52, 1], [53, 1], [54, 1], [55, 1], [56, 1], [57, 2.25], [58, 1]],
    [[59, 2.25], [60, 1], [61, 1], [62, 1], [63, 1], [64, 1], [65, 1], [66, 1], [67, 1], [68, 1], [69, 1], [70, 1.75], [71, 1]],
    [[72, 1.25], [73, 1.25], [74, 1.25], [75, 6.25], [76, 1], [77, 1], [78, 1, 1], [79, 1], [80, 1]],
  ];

  const keys = [];
  rows.forEach((row, r) => {
    let x = 0;
    row.forEach(([idx, w, gap]) => {
      x += gap || 0;
      keys[idx] = { idx, x, y: r + (r > 0 ? 0.25 : 0), w };
      x += w;
    });
  });

  const KEY_COUNT = 81;
  const FN_KEY_INDEX = 77;

  const base = [
    27, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 36,
    192, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 189, 187, 8, 46,
    9, 81, 87, 69, 82, 84, 89, 85, 73, 79, 80, 219, 221, 220, 33,
    20, 65, 83, 68, 70, 71, 72, 74, 75, 76, 186, 222, 13, 34,
    160, 90, 88, 67, 86, 66, 78, 77, 188, 190, 191, 161, 38,
    162, 91, 164, 32, 165, 245, 37, 40, 39,
  ];
  const fn1 = base.slice();
  Object.assign(fn1, {
    0: 0, 1: 243, 2: 175, 3: 174, 4: 173, 5: 177, 6: 179, 7: 176, 8: 178, 9: 172, 10: 184, 11: 185, 12: 170,
    14: 35, 29: 0, 30: 0, 41: 149, 42: 148, 43: 199, 71: 204, 73: 250, 78: 207, 79: 205, 80: 206,
  });
  const fn2 = new Array(KEY_COUNT).fill(0);
  Object.assign(fn2, { 2: 175, 3: 174, 74: 164, 76: 165 });
  const fn3 = new Array(KEY_COUNT).fill(0);
  Object.assign(fn3, { 2: 175, 3: 174 });

  const defaultLayers = [base, fn1, fn2, fn3];
  const layerNames = ['Base', 'Fn', 'Fn + Shift', 'Fn + Shift + Alt'];

  B.layout = { rows, keys, KEY_COUNT, FN_KEY_INDEX, defaultLayers, layerNames, width: 16, height: 6.25 };
})(typeof window !== 'undefined' ? window : globalThis);
