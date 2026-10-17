// Fake WebHID BOOG75 for headless UI tests. Loaded before the app scripts.
// Query parameters: ?nohid (no WebHID), ?fw=22 (firmware version, hex digits).
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const sent = [];
  window.__sent = sent;
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + (e.reason && (e.reason.stack || e.reason.message))));

  if (params.has('nohid')) {
    Object.defineProperty(navigator, 'hid', { value: undefined, configurable: true });
    return;
  }

  class FakeDevice extends EventTarget {
    constructor() {
      super();
      this.vendorId = 0x36b5;
      this.productId = 0x2f8f;
      this.productName = 'Gtech Magnetic Wired Keyboard';
      this.opened = false;
      this.mode = 'normal'; // normal | throw | hang
      this.version = parseInt(params.get('fw') || '30', 16);
      this.collections = [{ usagePage: 0xff01, usage: 1, outputReports: [{ reportId: 0, items: [] }], inputReports: [{ reportId: 0, items: [] }], featureReports: [] }];
    }
    async open() { this.opened = true; }
    async close() { this.opened = false; }
    reply(bytes) {
      const d = new Uint8Array(64);
      bytes.forEach((b, i) => (d[i] = b));
      setTimeout(() => {
        const ev = new Event('inputreport');
        ev.data = new DataView(d.buffer);
        ev.reportId = 0;
        ev.device = this;
        this.dispatchEvent(ev);
      }, 2);
    }
    sendReport(id, data) {
      if (!this.opened) return Promise.reject(new DOMException('closed', 'InvalidStateError'));
      if (this.mode === 'throw') return Promise.reject(new DOMException('Failed to write the report.', 'NotAllowedError'));
      if (this.mode === 'hang') return new Promise(() => {});
      const f = new Uint8Array(data);
      sent.push(f);
      const cmd = f[1];
      if (cmd === 0x02) this.reply([0, 0x02, 0, 10, this.version, 0, 0, 0, 0, 0x05, 0x12, 0]);
      else if (cmd === 0x19) this.reply([0, 0x19, 0, 26, 1, 3, 7, 1, 2, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255]);
      else if (cmd === 0x61) {
        const sub = f[4], mid = f[5];
        if (mid === 4) { // macro 5 exists: "Hi" = H down, H up, played twice
          const blob = new Array(215).fill(0);
          blob[0] = 35 + 6; blob[1] = 0;
          blob[2] = 72; blob[3] = 105; blob[34] = 2;
          blob.splice(35, 6, 72, 4, 128, 72, 4, 0);
          const part = blob.slice((sub & 3) * 58, (sub & 3) * 58 + 58);
          this.reply([0, 0x61, 0, part.length + 1, sub, ...part]);
        } else this.reply([0, 0x61, 0, 2, sub, 255]);
      }
      return Promise.resolve();
    }
  }
  const dev = new FakeDevice();
  window.__dev = dev;
  const hid = new EventTarget();
  hid.getDevices = async () => [];
  hid.requestDevice = async () => [dev];
  Object.defineProperty(navigator, 'hid', { value: hid, configurable: true });
})();
