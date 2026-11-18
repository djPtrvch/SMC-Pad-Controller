// JamboPad: SMC-PAD firmware for the JAMbo controller (two units side by side).
// The hardware side only; all behaviour is in jp_engine.cpp (tested on the host, tests/host).
// Board: "M-Vave SMC-PAD (open firmware)" from open-smc-pad's Boards Manager package.
#include <SMCPad.h>
#include <MIDIUSB.h>
#include <ArduinoBLE.h>
#include <BLEMIDI.h>
#include "jp_engine.h"

// Bluetooth: BLE-MIDI (the library, no SysEx yet) and our settings service, which carries the
// JAMboPAD SysEx (docs/sysex.md) as plain bytes in 20-byte pieces (fits any ATT MTU). The web
// configurator talks to it over Web Bluetooth.
static BLEService cfgService("4a50c0f1-0b1e-4d1a-9a7d-7d4a50000001");
static BLECharacteristic cfgChar("4a50c0f1-0b1e-4d1a-9a7d-7d4a50000002",
                                 BLEWrite | BLEWriteWithoutResponse | BLENotify, 20);
static uint8_t cfgRx[2048];
static volatile uint16_t cfgHead, cfgTail;
static bool bleStarted, bleWanted;

static void onCfgWrite(BLEDevice, BLECharacteristic c) {
    const uint8_t *v = c.value();
    for (int i = 0; i < c.valueLength(); i++) {
        uint16_t next = (uint16_t)((cfgHead + 1) % sizeof cfgRx);
        if (next == cfgTail) break;             // full: the rest is dropped (the host retries)
        cfgRx[cfgHead] = v[i];
        cfgHead = next;
    }
}

class PadHal : public jp::Hal {
public:
    void midiOut(const uint8_t *m, int n) override {
        if (n <= 0) return;
        if (m[0] == 0xF0) {
            sysexOut(m, n);
            if (bleStarted && cfgChar.subscribed()) cfgOut(m, n);
            return;
        }
        uint8_t p[4] = {(uint8_t)(m[0] >> 4), m[0], n > 1 ? m[1] : (uint8_t)0, n > 2 ? m[2] : (uint8_t)0};
        put(p);
        if (bleStarted && BLEMIDI.connected()) BLEMIDI.send(m[0], n > 1 ? m[1] : 0, n > 2 ? m[2] : 0);
    }
    void setBluetooth(bool on) override {
        bleWanted = on;
        if (!bleStarted) return;                // setup() applies it once BLE is up
        if (on) {
            BLE.advertise();
        } else {
            BLE.disconnect();
            BLE.stopAdvertise();
        }
    }
    // 3.5 mm MIDI OUT: PC5 (UART1 TX on the board), driven by software at 31250 baud, 8N1.
    // The core has no UART for it yet (open-smc-pad docs/gaps.md); bit timing from the
    // microsecond clock, so an interrupt delays an edge but errors do not add up.
    void dinOut(const uint8_t *m, int n) override {
        for (int i = 0; i < n; i++) dinByte(m[i]);
    }
    static void dinBegin() {
        smcpad_gpio_mode(DIN_PIN, SMCPAD_GPIO_OUTPUT);
        smcpad_gpio_write(DIN_PIN, 1);              // idle high
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
    static void cfgOut(const uint8_t *m, int n) {
        for (int i = 0; i < n; i += 20) {
            int k = n - i < 20 ? n - i : 20;
            for (int tries = 0; tries < 200 && !cfgChar.writeValue(m + i, k, false); tries++) smcpad_yield();
        }
    }
    static const uint32_t DIN_PIN = 32 + 5;         // PC5
    static const uint32_t BIT_US = 32;              // 1 / 31250 s
    static void dinByte(uint8_t b) {
        uint32_t t = smcpad_micros();
        uint16_t frame = (uint16_t)(b << 1 | 0x200);    // start bit 0, 8 data bits LSB first, stop bit 1
        for (int i = 0; i < 10; i++) {
            smcpad_gpio_write(DIN_PIN, (frame >> i) & 1);
            t += BIT_US;
            while ((int32_t)(smcpad_micros() - t) < 0) {}
        }
    }

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
    PadHal::dinBegin();
    BLE.begin();
    cfgService.addCharacteristic(cfgChar);
    cfgChar.setEventHandler(BLEWritten, onCfgWrite);
    BLE.addService(cfgService);                 // before BLEMIDI.begin(), which starts advertising
    engine.begin(millis());                     // loads the settings; asks for Bluetooth on or off
    BLEMIDI.begin(engine.device().side == jp::SIDE_LEFT ? "JAMboPAD L" : "JAMboPAD R");
    bleStarted = true;
    hal.setBluetooth(bleWanted);
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

    BLE.poll();
    while (cfgTail != cfgHead) {
        engine.midiIn(cfgRx[cfgTail], jp::Engine::PORT_BLE_CFG);
        cfgTail = (uint16_t)((cfgTail + 1) % sizeof cfgRx);
    }
    for (int k = 0; k < 32; k++) {
        midiEventPacket_t pk = BLEMIDI.read();
        if (pk.header == 0) break;
        int n = packetBytes(pk.header);
        if (n > 0) engine.midiIn(pk.byte1, jp::Engine::PORT_BLE_MIDI);
        if (n > 1) engine.midiIn(pk.byte2, jp::Engine::PORT_BLE_MIDI);
        if (n > 2) engine.midiIn(pk.byte3, jp::Engine::PORT_BLE_MIDI);
    }

    engine.tick(now);
    MidiUSB.flush();
    BLEMIDI.flush();

    if (!bootConfirmed && now > 3000) {
        bootConfirmed = true;
        smcpad_boot_ok();
    }
}
