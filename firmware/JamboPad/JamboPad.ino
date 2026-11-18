// JamboPad: SMC-PAD firmware for the JAMbo controller (two units side by side).
// The hardware side only; all behaviour is in jp_engine.cpp (tested on the host, tests/host).
// Board: "M-Vave SMC-PAD (open firmware)" from open-smc-pad's Boards Manager package.
#include <SMCPad.h>
#include <MIDIUSB.h>
#include "jp_engine.h"

class PadHal : public jp::Hal {
public:
    void midiOut(const uint8_t *m, int n) override {
        if (n <= 0) return;
        if (m[0] == 0xF0) { sysexOut(m, n); return; }
        uint8_t p[4] = {(uint8_t)(m[0] >> 4), m[0], n > 1 ? m[1] : (uint8_t)0, n > 2 ? m[2] : (uint8_t)0};
        put(p);
    }
    void padRgb(int pad, uint32_t rgb) override { SMCPad.padColor(pad, rgb); }
    void padShow() override { SMCPad.show(); }
    void buttonLed(int b, bool on) override { SMCPad.buttonLed(b, on); }
    int storeRead(int key, void *buf, int len) override { return smcpad_store_read(key, buf, len); }
    int storeWrite(int key, const void *buf, int len) override { return smcpad_store_write(key, buf, len); }
    void enterBootloader() override {
        smcpad_usbmidi_flush();
        smcpad_delay(50);                   // let the reply go out
        smcpad_enter_bootloader();
    }

private:
    // a full queue: wait for USB (bounded, so a host that stopped reading cannot hang us)
    static void put(const uint8_t p[4]) {
        for (int tries = 0; tries < 200; tries++) {
            if (smcpad_usbmidi_write(p)) return;
            smcpad_yield();
        }
    }
    // USB-MIDI SysEx: CIN 4 = three bytes, then CIN 5/6/7 with the last 1/2/3 bytes
    static void sysexOut(const uint8_t *m, int n) {
        int i = 0;
        while (n - i > 3) {
            uint8_t p[4] = {0x04, m[i], m[i + 1], m[i + 2]};
            put(p);
            i += 3;
        }
        int rest = n - i;
        uint8_t p[4] = {(uint8_t)(0x04 + rest), m[i], rest > 1 ? m[i + 1] : (uint8_t)0, rest > 2 ? m[i + 2] : (uint8_t)0};
        put(p);
        smcpad_usbmidi_flush();
    }
};

static PadHal hal;
static jp::Engine engine(hal);
static uint32_t lastRound;
static bool bootConfirmed;

// bytes carried by a USB-MIDI packet, by its code index number
static int packetBytes(uint8_t cin) {
    switch (cin & 0x0F) {
        case 0x5: case 0xF: return 1;
        case 0x2: case 0x6: case 0xC: case 0xD: return 2;
        case 0x0: case 0x1: return 0;
        default: return 3;
    }
}

void setup() {
    SMCPad.begin();
    engine.begin(millis());
    lastRound = smcpad_pad_rounds();
}

void loop() {
    uint32_t now = millis();

    smcpad_event_t ev;
    while (SMCPad.read(ev)) {
        switch (ev.type) {
            case SMCPAD_EV_BUTTON_DOWN: engine.buttonEvent(ev.index, true, now); break;
            case SMCPAD_EV_BUTTON_UP: engine.buttonEvent(ev.index, false, now); break;
            case SMCPAD_EV_ENCODER: engine.knobEvent(ev.index, ev.value); break;
            default: break;         // the core's own pad events: the engine detects hits itself
        }
    }

    uint32_t round = smcpad_pad_rounds();
    if (round != lastRound) {
        lastRound = round;
        for (int p = 0; p < jp::PADS; p++) engine.padSample(p, smcpad_pad_raw(p), now);
    }

    for (int k = 0; k < 32; k++) {
        midiEventPacket_t pk = MidiUSB.read();
        if (pk.header == 0) break;
        int n = packetBytes(pk.header);
        if (n > 0) engine.midiIn(pk.byte1);
        if (n > 1) engine.midiIn(pk.byte2);
        if (n > 2) engine.midiIn(pk.byte3);
    }

    engine.tick(now);
    MidiUSB.flush();

    if (!bootConfirmed && now > 3000) {
        bootConfirmed = true;
        smcpad_boot_ok();
    }
}
