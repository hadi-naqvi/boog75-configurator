// WebHID transport for the BOOG75.
// All traffic goes through a single serialized queue: one frame at a time,
// each write awaited, with a short pause between frames. The official tool
// fires every report without waiting, which is fragile.
(function (root) {
  'use strict';
  const B = (root.Boog = root.Boog || {});
  const P = B.protocol;

  // Timings (ms). Exposed as Boog75Device.timing so tests can shorten them.
  const T = { gap: 8, ackWait: 60, responseTimeout: 800, writeTimeout: 3000 };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class Boog75Device extends EventTarget {
    constructor() {
      super();
      this.dev = null;
      this.reportId = 0;
      this.queue = Promise.resolve();
      this.waiters = [];
      this.dryRun = false;
      this.ackSeen = false;
      this.writesWithoutAck = 0;
      this.sentFrames = 0;
      if (B.webHidSupported()) {
        navigator.hid.addEventListener('disconnect', (e) => {
          if (this.dev && e.device === this.dev) this._lost('Keyboard disconnected');
        });
        navigator.hid.addEventListener('connect', (e) => this.dispatchEvent(new CustomEvent('available', { detail: e.device })));
      }
    }

    get connected() { return !!this.dev && this.dev.opened; }

    static isVendorInterface(d) {
      return d.vendorId === P.VENDOR_ID && d.productId === P.PRODUCT_ID &&
        (d.collections || []).some((c) => c.usagePage === P.USAGE_PAGE);
    }

    // Reconnect to a keyboard the user already granted, without a prompt.
    async autoConnect() {
      if (!B.webHidSupported() || this.connected) return false;
      const devs = (await navigator.hid.getDevices()).filter(Boog75Device.isVendorInterface);
      if (!devs.length) return false;
      await this._open(devs[0]);
      return true;
    }

    async requestConnect() {
      const devs = await navigator.hid.requestDevice({
        filters: [{ vendorId: P.VENDOR_ID, productId: P.PRODUCT_ID, usagePage: P.USAGE_PAGE }],
      });
      const d = devs.find(Boog75Device.isVendorInterface);
      if (!d) return false;
      await this._open(d);
      return true;
    }

    _open(d) {
      // Serialize opens: replugging fires one 'connect' event per USB interface.
      const run = (this._opening || Promise.resolve()).then(() => this._openNow(d));
      this._opening = run.catch(() => {});
      return run;
    }

    async _openNow(d) {
      if (this.dev === d && d.opened) return;
      await this.disconnect();
      if (!d.opened) await d.open();
      const col = d.collections.find((c) => c.usagePage === P.USAGE_PAGE);
      this.reportId = (col.outputReports && col.outputReports[0] && col.outputReports[0].reportId) || 0;
      this._onInput = (e) => this._handleInput(e);
      d.addEventListener('inputreport', this._onInput);
      this.dev = d;
      this.queue = Promise.resolve();
      this.ackSeen = false;
      this.writesWithoutAck = 0;
      this.dispatchEvent(new CustomEvent('connected'));
    }

    async disconnect() {
      const d = this.dev;
      this.dev = null;
      this._rejectWaiters(new Error('disconnected'));
      if (d) {
        d.removeEventListener('inputreport', this._onInput);
        try { if (d.opened) await d.close(); } catch (e) { /* already gone */ }
        this.dispatchEvent(new CustomEvent('disconnected', { detail: 'Disconnected' }));
      }
    }

    _lost(reason) {
      const d = this.dev;
      this.dev = null;
      this._rejectWaiters(new Error(reason));
      if (d) d.removeEventListener('inputreport', this._onInput);
      this.dispatchEvent(new CustomEvent('disconnected', { detail: reason }));
    }

    _rejectWaiters(err) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((x) => { clearTimeout(x.timer); x.reject(err); });
    }

    _handleInput(e) {
      const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      const copy = new Uint8Array(data);
      const cmd = P.commandOf(copy);
      if (cmd === P.CMD.ACK) this.ackSeen = true;
      this.dispatchEvent(new CustomEvent('rx', { detail: { data: copy, cmd } }));
      // Each report goes to the first waiter that wants it.
      const w = this.waiters.find((x) => x.match(copy, cmd));
      if (w) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(copy);
      }
    }

    _waitFor(match, timeoutMs) {
      return new Promise((resolve, reject) => {
        const w = { match, resolve, reject };
        w.timer = setTimeout(() => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error('timeout'));
        }, timeoutMs);
        this.waiters.push(w);
      });
    }

    // sendReport with a deadline. If the keyboard stops accepting reports the
    // browser's promise never settles, so give up, drop the connection and
    // report it instead of hanging forever.
    async _sendReport(f) {
      const d = this.dev;
      if (!d || !d.opened) throw new Error('Keyboard not connected');
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the keyboard did not accept a frame within ${T.writeTimeout / 1000} s`)), T.writeTimeout);
      });
      try {
        await Promise.race([d.sendReport(this.reportId, f), timeout]);
      } catch (e) {
        if (/did not accept/.test(e.message)) {
          this.dispatchEvent(new CustomEvent('stall', { detail: { data: f } }));
          if (this.dev === d) this._lost('Keyboard stopped responding: ' + e.message + '. Unplug and replug it, then reconnect.');
          Promise.resolve().then(() => d.close()).catch(() => {});
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }

    async _write(f) {
      this.dispatchEvent(new CustomEvent('tx', { detail: { data: f, dry: this.dryRun } }));
      if (this.dryRun) return;
      if (!this.connected) throw new Error('Keyboard not connected');
      const ack = this.ackSeen || this.writesWithoutAck < 3
        ? this._waitFor((d, cmd) => cmd === P.CMD.ACK, T.ackWait).catch(() => null)
        : null;
      await this._sendReport(f);
      this.sentFrames++;
      if (ack) {
        const got = await ack;
        if (!got) this.writesWithoutAck++;
      }
      await sleep(T.gap);
    }

    // Run fn exclusively on the queue. Errors propagate to the caller but do not jam the queue.
    _exclusive(fn) {
      const run = this.queue.then(fn, fn);
      this.queue = run.catch(() => {});
      return run;
    }

    // Send frames in order. onProgress(done, total) is optional.
    send(frames, onProgress) {
      return this._exclusive(async () => {
        for (let i = 0; i < frames.length; i++) {
          await this._write(frames[i]);
          if (onProgress) onProgress(i + 1, frames.length);
        }
      });
    }

    // Send request frames and collect up to `count` matching responses.
    // Returns whatever arrived before the timeout (possibly fewer than `count`).
    request(frames, match, count) {
      return this._exclusive(async () => {
        if (!this.connected) throw new Error('Keyboard not connected');
        const results = [];
        let resolveDone;
        const done = new Promise((r) => (resolveDone = r));
        let timer;
        const collector = {
          match: (d, cmd) => match(d, cmd),
          resolve: (d) => {
            results.push(d);
            if (results.length >= count) { clearTimeout(timer); resolveDone(); } else this.waiters.push(collector);
          },
          reject: () => resolveDone(),
        };
        this.waiters.push(collector);
        try {
          for (const f of frames) {
            this.dispatchEvent(new CustomEvent('tx', { detail: { data: f, dry: false } }));
            await this._sendReport(f);
            await sleep(T.gap);
          }
          timer = setTimeout(resolveDone, T.responseTimeout);
          await done;
        } finally {
          clearTimeout(timer);
          const i = this.waiters.indexOf(collector);
          if (i >= 0) this.waiters.splice(i, 1);
        }
        return results;
      });
    }

    async readVersion() {
      const [d] = await this.request(P.getVersion(), (d, cmd) => cmd === P.CMD.VERSION, 1);
      if (!d) throw new Error('No reply to version request');
      return P.parseVersion(d);
    }
    async readRgb() {
      const [d] = await this.request(P.getRgb(), (d, cmd) => cmd === P.CMD.GET_RGB, 1);
      if (!d) throw new Error('No reply to lighting request');
      return P.parseRgb(d);
    }
    // Returns a macro object, null for an empty slot, or throws if the reply is unusable.
    async readMacro(id) {
      const frames = await this.request(P.getMacro(id), (d, cmd) => cmd === P.CMD.GET_MACRO, 4);
      frames.sort((a, b) => a[4] - b[4]);
      if (frames.length && frames[0][4] === 0x40 && frames[0][5] === 255) return null;
      if (frames.length < 4) throw new Error(`Macro ${id + 1}: only ${frames.length}/4 reply frames`);
      return P.parseMacroFrames(id, frames);
    }
  }

  Boog75Device.timing = T;
  B.webHidSupported = () => typeof navigator !== 'undefined' && !!navigator.hid;
  B.Boog75Device = Boog75Device;
})(typeof window !== 'undefined' ? window : globalThis);
