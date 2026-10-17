// Transport tests against a fake WebHID device.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

class FakeHid extends EventTarget {
  constructor() { super(); this.devices = []; this.granted = []; }
  async getDevices() { return this.granted; }
  async requestDevice() { return this.devices; }
}
class FakeDevice extends EventTarget {
  constructor(opts = {}) {
    super();
    this.vendorId = opts.vendorId ?? 0x36b5;
    this.productId = 0x2f8f;
    this.opened = false;
    this.collections = [{ usagePage: opts.usagePage ?? 0xff01, outputReports: [{ reportId: opts.reportId ?? 0 }], inputReports: [{ reportId: 0 }] }];
    this.sent = [];
    this.mode = 'normal'; // normal | silent | throw | hang | ack
    this.version = 0x30;
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  reply(bytes) {
    const d = new Uint8Array(64);
    bytes.forEach((b, i) => (d[i] = b));
    setTimeout(() => { const ev = new Event('inputreport'); ev.data = new DataView(d.buffer); this.dispatchEvent(ev); }, 1);
  }
  sendReport(id, data) {
    if (this.mode === 'throw') return Promise.reject(new Error('NotAllowedError: Failed to write the report.'));
    if (this.mode === 'hang') return new Promise(() => {});
    this.sent.push({ id, data: new Uint8Array(data) });
    const cmd = data[1];
    if (this.mode === 'ack' && ![0x02, 0x19, 0x61].includes(cmd)) this.reply([0, 0x05]);
    if (this.mode !== 'silent') {
      if (cmd === 0x02) this.reply([0, 0x02, 0, 10, this.version, 0, 0, 0, 0, 5, 0x12]);
      if (cmd === 0x19) this.reply([0, 0x19, 0, 26, 1, 4, 6, 0, 3, ...new Array(21).fill(0x80)]);
      if (cmd === 0x61) {
        if (data[5] === 7) {
          const blob = new Array(215).fill(0); blob[0] = 41; blob[2] = 65; blob[34] = 254; blob.splice(35, 6, 65, 2, 128, 65, 2, 0);
          const part = blob.slice((data[4] & 3) * 58, (data[4] & 3) * 58 + 58);
          this.reply([0, 0x61, 0, part.length + 1, data[4], ...part]);
        } else if (data[5] === 8) {
          if ((data[4] & 3) === 0) this.reply([0, 0x61, 0, 59, 0x40, 41, 0]); // only the first chunk arrives
        } else this.reply([0, 0x61, 0, 2, data[4], 255]);
      }
    }
    return Promise.resolve();
  }
}

const hid = new FakeHid();
// Each test creates a new Boog75Device on this shared fake; the real app creates one.
require('node:events').setMaxListeners(100, hid);
Object.defineProperty(globalThis, 'navigator', { value: { hid }, configurable: true, writable: true });
const { load } = require('./helpers');
const B = load('device');
const P = B.protocol;
const T = B.Boog75Device.timing;
Object.assign(T, { gap: 0, ackWait: 15, responseTimeout: 60, writeTimeout: 80 });

async function connected(opts) {
  const d = new FakeDevice(opts);
  hid.devices = [d];
  const dev = new B.Boog75Device();
  assert.equal(await dev.requestConnect(), true);
  return { dev, d };
}

test('connects only to the vendor interface and reads the version', async () => {
  hid.devices = [new FakeDevice({ usagePage: 0x0001 })];
  const dev = new B.Boog75Device();
  assert.equal(await dev.requestConnect(), false);
  hid.devices = [new FakeDevice({ vendorId: 0x1234 })];
  assert.equal(await dev.requestConnect(), false);
  const { dev: dev2 } = await connected();
  assert.ok(dev2.connected);
  const v = await dev2.readVersion();
  assert.equal(v.label, 'V30');
});

test('autoConnect uses granted devices without a prompt', async () => {
  const d = new FakeDevice();
  hid.granted = [d];
  const dev = new B.Boog75Device();
  assert.equal(await dev.autoConnect(), true);
  assert.ok(d.opened);
  assert.equal(await dev.autoConnect(), false, 'already connected');
  hid.granted = [];
});

test('send() writes frames in order with the collection report id', async () => {
  const { dev, d } = await connected({ reportId: 0 });
  const frames = P.setTriggers(Array.from({ length: 81 }, () => ({ make: 10, brk: 10, tgl: false })));
  const progress = [];
  await dev.send(frames, (i, n) => progress.push(`${i}/${n}`));
  assert.equal(d.sent.length, 6);
  d.sent.forEach((s, i) => { assert.equal(s.id, 0); assert.deepEqual(Array.from(s.data), Array.from(frames[i])); });
  assert.deepEqual(progress, ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
});

test('dry run sends nothing but still emits tx events', async () => {
  const { dev, d } = await connected();
  dev.dryRun = true;
  const tx = [];
  dev.addEventListener('tx', (e) => tx.push(e.detail));
  await dev.send(P.getRgb());
  assert.equal(d.sent.length, 0);
  assert.equal(tx.length, 1);
  assert.equal(tx[0].dry, true);
});

test('reads work: rgb, macros (present, empty, partial)', async () => {
  const { dev } = await connected();
  const rgb = await dev.readRgb();
  assert.equal(rgb.effect, 4); assert.equal(rgb.speed, 3); assert.equal(rgb.colors[0], '#808080');
  const m = await dev.readMacro(7);
  assert.deepEqual(m, { id: 7, name: 'A', steps: [{ vk: 65, delay: 10, down: true }, { vk: 65, delay: 10, down: false }], mode: 'hold', count: 1 });
  assert.equal(await dev.readMacro(3), null);
  await assert.rejects(dev.readMacro(8), /only 1\/4/);
});

test('reads time out cleanly when the keyboard is silent', async () => {
  const { dev, d } = await connected();
  d.mode = 'silent';
  await assert.rejects(dev.readVersion(), /No reply/);
  d.mode = 'normal';
  assert.equal((await dev.readVersion()).label, 'V30', 'queue still usable afterwards');
});

test('a failing write rejects but does not jam the queue', async () => {
  const { dev, d } = await connected();
  d.mode = 'throw';
  await assert.rejects(dev.send(P.getRgb()), /Failed to write/);
  assert.ok(dev.connected, 'a plain write error keeps the connection');
  d.mode = 'normal';
  await dev.send(P.getRgb());
  assert.equal(d.sent.length, 1);
});

test('a stalled write times out, drops the connection and reports it', async () => {
  const { dev, d } = await connected();
  const events = [];
  dev.addEventListener('stall', () => events.push('stall'));
  dev.addEventListener('disconnected', (e) => events.push('disconnected:' + e.detail));
  d.mode = 'hang';
  await assert.rejects(dev.send([...P.getRgb(), ...P.getRgb()]), /did not accept a frame/);
  assert.equal(dev.connected, false);
  assert.equal(events[0], 'stall');
  assert.match(events[1], /disconnected:Keyboard stopped responding/);
  await assert.rejects(dev.send(P.getRgb()), /not connected/);
});

test('acks are waited for when the keyboard sends them', async () => {
  const { dev, d } = await connected();
  d.mode = 'ack';
  const t0 = Date.now();
  await dev.send(Array.from({ length: 5 }, () => P.setRgb({ on: 1, effect: 1, brightness: 1, speed: 1, colorIndex: 0, colors: B.profile.DEFAULT_COLORS })[0]));
  assert.ok(dev.ackSeen);
  assert.ok(Date.now() - t0 < 5 * T.ackWait, 'did not wait for full ack timeouts');
});

test('without acks it stops waiting for them after a few frames', async () => {
  const { dev, d } = await connected();
  d.mode = 'silent';
  await dev.send(Array.from({ length: 6 }, () => P.getRgb()[0]));
  assert.equal(dev.writesWithoutAck, 3);
  assert.equal(dev.ackSeen, false);
});

test('unplugging rejects pending reads and emits disconnected', async () => {
  const { dev, d } = await connected();
  d.mode = 'silent';
  const pending = dev.readMacro(1);
  const gone = new Promise((r) => dev.addEventListener('disconnected', (e) => r(e.detail)));
  setTimeout(() => { const ev = new Event('disconnect'); ev.device = d; hid.dispatchEvent(ev); }, 5);
  assert.equal(await gone, 'Keyboard disconnected');
  await assert.rejects(pending);
  assert.equal(dev.connected, false);
});

test('inbound reports are each delivered to one waiter', async () => {
  const { dev } = await connected();
  const [a, b] = await Promise.all([dev.readVersion(), dev.readRgb()]);
  assert.equal(a.label, 'V30');
  assert.equal(b.effect, 4);
});

test('disconnect() closes the device', async () => {
  const { dev, d } = await connected();
  await dev.disconnect();
  assert.equal(d.opened, false);
  assert.equal(dev.connected, false);
});
