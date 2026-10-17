// Keycodes understood by the BOOG75 firmware.
// The firmware uses Windows virtual-key (VK) numbers, not HID usages.
// Values and the categories below mirror the official configurator.
(function (root) {
  'use strict';
  const B = (root.Boog = root.Boog || {});

  const VK = {
    NONE: 0, LBUTTON: 1, RBUTTON: 2, MBUTTON: 4, XBUTTON1: 5, XBUTTON2: 6,
    BACK: 8, TAB: 9, RETURN: 13, SHIFT: 16, CONTROL: 17, MENU: 18, PAUSE: 19,
    CAPITAL: 20, ESCAPE: 27, SPACE: 32, PRIOR: 33, NEXT: 34, END: 35, HOME: 36,
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, PRINT: 42, SNAPSHOT: 44, INSERT: 45, DELETE: 46,
    LWIN: 91, RWIN: 92, APPS: 93, SLEEP: 95,
    NUMPAD0: 96, MULTIPLY: 106, ADD: 107, SEPARATOR: 108, SUBTRACT: 109, DECIMAL: 110, DIVIDE: 111,
    F1: 112, F13: 124, F24: 135,
    SCROLL_UP: 136, SCROLL_DOWN: 137, SCROLL_LEFT: 138, SCROLL_RIGHT: 139,
    NUMLOCK: 144, SCROLL: 145, RGB_EFFECT: 148, RGB_COLOR: 149, MACRO: 152,
    LSHIFT: 160, RSHIFT: 161, LCONTROL: 162, RCONTROL: 163, LMENU: 164, RMENU: 165,
    BROWSER_BACK: 166, BROWSER_FORWARD: 167, BROWSER_REFRESH: 168, BROWSER_STOP: 169,
    BROWSER_SEARCH: 170, BROWSER_FAVORITES: 171, BROWSER_HOME: 172,
    VOLUME_MUTE: 173, VOLUME_DOWN: 174, VOLUME_UP: 175,
    MEDIA_NEXT: 176, MEDIA_PREV: 177, MEDIA_STOP: 178, MEDIA_PLAY_PAUSE: 179,
    LAUNCH_MAIL: 180, LAUNCH_MEDIA: 181, LAUNCH_APP1: 182, LAUNCH_APP2: 183,
    MY_COMPUTER: 184, CALCULATOR: 185,
    OEM_1: 186, OEM_PLUS: 187, OEM_COMMA: 188, OEM_MINUS: 189, OEM_PERIOD: 190, OEM_2: 191, OEM_3: 192,
    RGB_SWITCH: 199, RGB_BRIGHT_UP: 204, RGB_BRIGHT_DOWN: 205, RGB_SPEED_UP: 206, RGB_SPEED_DOWN: 207,
    ADVANCED_KEY: 218, OEM_4: 219, OEM_5: 220, OEM_6: 221, OEM_7: 222, OEM_102: 226,
    CALL_MUTE: 243, FN: 245, DISABLE_LGUI: 250,
  };

  // [vk, short label, long name]
  const entries = [];
  const add = (vk, label, name) => entries.push({ vk, label, name: name || label.replace(/\n/g, ' ') });

  add(0, '', 'None (disabled)');
  for (let c = 65; c <= 90; c++) add(c, String.fromCharCode(c));
  for (let d = 0; d <= 9; d++) add(48 + d, String(d));
  add(189, '-', 'Minus'); add(187, '=', 'Equal'); add(219, '[', 'Left bracket'); add(221, ']', 'Right bracket');
  add(220, '\\', 'Backslash'); add(186, ';', 'Semicolon'); add(222, "'", 'Quote'); add(188, ',', 'Comma');
  add(190, '.', 'Period'); add(191, '/', 'Slash'); add(192, '`', 'Grave'); add(226, '\\|', 'ISO backslash');
  add(27, 'Esc', 'Escape'); add(9, 'Tab'); add(20, 'Caps\nLock'); add(8, 'Back\nspace', 'Backspace');
  add(13, 'Enter'); add(32, 'Space');
  add(162, 'L Ctrl', 'Left Ctrl'); add(163, 'R Ctrl', 'Right Ctrl'); add(160, 'L Shift', 'Left Shift');
  add(161, 'R Shift', 'Right Shift'); add(164, 'L Alt', 'Left Alt'); add(165, 'R Alt', 'Right Alt');
  add(91, 'L Win', 'Left Super/Win'); add(92, 'R Win', 'Right Super/Win'); add(93, 'Menu', 'Application/Menu');
  add(38, '↑', 'Up'); add(40, '↓', 'Down'); add(37, '←', 'Left'); add(39, '→', 'Right');
  add(44, 'PrtSc', 'Print Screen'); add(145, 'Scroll\nLock'); add(19, 'Pause');
  add(36, 'Home'); add(35, 'End'); add(45, 'Ins', 'Insert'); add(46, 'Del', 'Delete');
  add(33, 'PgUp', 'Page Up'); add(34, 'PgDn', 'Page Down');
  for (let f = 1; f <= 24; f++) add(111 + f, 'F' + f);
  add(144, 'Num\nLock');
  for (let n = 0; n <= 9; n++) add(96 + n, 'Num ' + n, 'Numpad ' + n);
  add(111, 'Num /', 'Numpad /'); add(106, 'Num *', 'Numpad *'); add(109, 'Num -', 'Numpad -');
  add(107, 'Num +', 'Numpad +'); add(110, 'Num .', 'Numpad .'); add(108, 'Num\nEnter', 'Numpad Enter');
  add(175, 'Vol+', 'Volume Up'); add(174, 'Vol-', 'Volume Down'); add(173, 'Mute');
  add(179, 'Play/\nPause', 'Play / Pause'); add(176, 'Next', 'Next Track'); add(177, 'Prev', 'Previous Track');
  add(178, 'Stop', 'Media Stop'); add(243, 'Mic\nMute', 'Call Mute');
  add(166, 'Web\nBack', 'Browser Back'); add(167, 'Web\nFwd', 'Browser Forward');
  add(168, 'Web\nRefresh', 'Browser Refresh'); add(169, 'Web\nStop', 'Browser Stop');
  add(170, 'Search', 'Browser Search'); add(171, 'Favs', 'Browser Favorites'); add(172, 'Web\nHome', 'Browser Home');
  add(180, 'Mail'); add(181, 'Media', 'Media Player'); add(184, 'My PC', 'My Computer'); add(185, 'Calc', 'Calculator');
  add(182, 'App 1', 'Launch App 1'); add(183, 'App 2', 'Launch App 2'); add(95, 'Sleep');
  add(1, 'Mouse\nLeft', 'Mouse Left'); add(2, 'Mouse\nRight', 'Mouse Right'); add(4, 'Mouse\nMiddle', 'Mouse Middle');
  add(5, 'Mouse\nBack', 'Mouse Back (4)'); add(6, 'Mouse\nFwd', 'Mouse Forward (5)');
  add(136, 'Wheel\nUp', 'Scroll Up'); add(137, 'Wheel\nDown', 'Scroll Down');
  add(138, 'Wheel\nLeft', 'Scroll Left'); add(139, 'Wheel\nRight', 'Scroll Right');
  add(199, 'RGB\nOn/Off', 'RGB On/Off'); add(148, 'RGB\nMode', 'RGB Next Effect'); add(149, 'RGB\nColor', 'RGB Next Color');
  add(204, 'RGB\nBri+', 'RGB Brightness +'); add(205, 'RGB\nBri-', 'RGB Brightness -');
  add(206, 'RGB\nSpd+', 'RGB Speed +'); add(207, 'RGB\nSpd-', 'RGB Speed -');
  add(245, 'Fn'); add(250, 'Win\nLock', 'Disable Win key (toggle)');

  const byVk = new Map(entries.map((e) => [e.vk, e]));

  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const categories = [
    { id: 'basic', name: 'Letters & symbols', vks: [...range(65, 90), ...range(48, 57), 189, 187, 219, 221, 220, 186, 222, 188, 190, 191, 192, 226] },
    { id: 'control', name: 'Control & navigation', vks: [27, 9, 20, 8, 13, 32, 162, 163, 160, 161, 164, 165, 91, 92, 93, 38, 40, 37, 39, 44, 145, 19, 36, 35, 45, 46, 33, 34, 0] },
    { id: 'fkeys', name: 'Function keys', vks: range(112, 135) },
    { id: 'numpad', name: 'Numpad', vks: [144, ...range(96, 105), 111, 106, 109, 107, 110, 108] },
    { id: 'media', name: 'Media & apps', vks: [175, 174, 173, 179, 176, 177, 178, 243, 166, 167, 168, 169, 170, 171, 172, 180, 181, 184, 185, 182, 183, 95] },
    { id: 'mouse', name: 'Mouse', vks: [1, 2, 4, 5, 6, 136, 137, 138, 139] },
    { id: 'special', name: 'Keyboard & RGB', vks: [245, 250, 199, 148, 149, 204, 205, 206, 207] },
  ];

  // Codes a user may assign directly. Macro/advanced-key codes are assigned via their own tabs.
  const assignable = new Set(entries.map((e) => e.vk));

  // Browser KeyboardEvent.code -> VK, used for macro recording and "press a key to select".
  const codeToVk = {
    Escape: 27, Tab: 9, CapsLock: 20, Backspace: 8, Enter: 13, Space: 32,
    ShiftLeft: 160, ShiftRight: 161, ControlLeft: 162, ControlRight: 163, AltLeft: 164, AltRight: 165,
    MetaLeft: 91, MetaRight: 92, OSLeft: 91, OSRight: 92, ContextMenu: 93,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    PrintScreen: 44, ScrollLock: 145, Pause: 19, Home: 36, End: 35, Insert: 45, Delete: 46, PageUp: 33, PageDown: 34,
    Minus: 189, Equal: 187, BracketLeft: 219, BracketRight: 221, Backslash: 220, Semicolon: 186, Quote: 222,
    Backquote: 192, Comma: 188, Period: 190, Slash: 191, IntlBackslash: 226,
    NumLock: 144, NumpadDivide: 111, NumpadMultiply: 106, NumpadSubtract: 109, NumpadAdd: 107,
    NumpadDecimal: 110, NumpadEnter: 108,
    AudioVolumeUp: 175, AudioVolumeDown: 174, AudioVolumeMute: 173, VolumeUp: 175, VolumeDown: 174, VolumeMute: 173,
    MediaPlayPause: 179, MediaTrackNext: 176, MediaTrackPrevious: 177, MediaStop: 178,
  };
  for (let c = 65; c <= 90; c++) codeToVk['Key' + String.fromCharCode(c)] = c;
  for (let d = 0; d <= 9; d++) { codeToVk['Digit' + d] = 48 + d; codeToVk['Numpad' + d] = 96 + d; }
  for (let f = 1; f <= 24; f++) codeToVk['F' + f] = 111 + f;

  function label(vk) {
    const e = byVk.get(vk);
    return e ? e.label : '0x' + vk.toString(16);
  }
  function name(vk) {
    const e = byVk.get(vk);
    return e ? e.name : 'Unknown (0x' + vk.toString(16) + ')';
  }

  B.keycodes = { VK, entries, byVk, categories, assignable, codeToVk, label, name };
})(typeof window !== 'undefined' ? window : globalThis);
