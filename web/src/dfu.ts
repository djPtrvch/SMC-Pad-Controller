// USB DFU 1.1 download over WebUSB, for open-smc-pad's bootloader (USB 1209:0002):
// alt 0 = the application area (the sketch's .bin as the Arduino platform builds it), 4096-byte
// blocks; the bootloader checks the area's CRC at manifestation and restarts into the firmware.
export const BOOT_VID = 0x1209, BOOT_PID = 0x0002;
const BLOCK = 4096;
const REQ = { DNLOAD: 1, GETSTATUS: 3, CLRSTATUS: 4, ABORT: 6 };
const STATE = { IDLE: 2, DNLOAD_SYNC: 3, DNBUSY: 4, DNLOAD_IDLE: 5, MANIFEST_SYNC: 6, MANIFEST: 7, MANIFEST_WAIT_RESET: 8, ERROR: 10 };

export interface DfuStatus { status: number; pollMs: number; state: number }

export class DfuDevice {
  private constructor(readonly dev: USBDevice, readonly iface: number) {}

  static async request(): Promise<DfuDevice> {
    const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: BOOT_VID, productId: BOOT_PID }] });
    return DfuDevice.open(dev);
  }

  static async open(dev: USBDevice): Promise<DfuDevice> {
    await dev.open();
    if (!dev.configuration) await dev.selectConfiguration(1);
    const iface = dev.configuration!.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 0xfe && a.interfaceSubclass === 1));
    if (!iface) throw new Error('no DFU interface on this device');
    await dev.claimInterface(iface.interfaceNumber);
    await dev.selectAlternateInterface(iface.interfaceNumber, 0);
    return new DfuDevice(dev, iface.interfaceNumber);
  }

  private setup(request: number, value = 0) {
    return { requestType: 'class' as const, recipient: 'interface' as const, request, value, index: this.iface };
  }

  async getStatus(): Promise<DfuStatus> {
    const r = await this.dev.controlTransferIn(this.setup(REQ.GETSTATUS), 6);
    const d = r.data!;
    return { status: d.getUint8(0), pollMs: d.getUint8(1) | (d.getUint8(2) << 8) | (d.getUint8(3) << 16), state: d.getUint8(4) };
  }

  private async clearError() {
    const s = await this.getStatus();
    if (s.state === STATE.ERROR) await this.dev.controlTransferOut(this.setup(REQ.CLRSTATUS));
    else if (s.state !== STATE.IDLE) await this.dev.controlTransferOut(this.setup(REQ.ABORT));
  }

  private async waitIdle(until: number[]): Promise<DfuStatus> {
    for (;;) {
      const s = await this.getStatus();
      if (s.state === STATE.ERROR) throw new Error(`DFU error (status ${s.status}): the image was refused`);
      if (until.includes(s.state)) return s;
      await new Promise((r) => setTimeout(r, Math.max(s.pollMs, 5)));
    }
  }

  // writes the image; progress 0..1
  async download(image: Uint8Array, progress: (f: number) => void): Promise<void> {
    await this.clearError();
    const blocks = Math.ceil(image.length / BLOCK);
    for (let n = 0; n < blocks; n++) {
      const chunk = image.slice(n * BLOCK, Math.min(image.length, (n + 1) * BLOCK));
      await this.dev.controlTransferOut(this.setup(REQ.DNLOAD, n), chunk);
      await this.waitIdle([STATE.DNLOAD_IDLE]);
      progress((n + 1) / blocks);
    }
    // a zero-length block ends the download: the bootloader checks the CRC and restarts
    await this.dev.controlTransferOut(this.setup(REQ.DNLOAD, blocks), new Uint8Array(0));
    try {
      await this.waitIdle([STATE.IDLE, STATE.MANIFEST, STATE.MANIFEST_WAIT_RESET]);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('DFU error')) throw e;
      // the device left the bus to restart: that is success
    }
  }

  async close() {
    try {
      await this.dev.releaseInterface(this.iface);
      await this.dev.close();
    } catch {
      /* already gone */
    }
  }
}
