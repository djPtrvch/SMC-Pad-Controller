// Host tests of the firmware engine: g++ -std=c++17 (tests/host/run.sh).
// Also writes tests/vectors/vectors.json, which the web tests compare against.
#include "../../firmware/JamboPad/jp_engine.h"
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>

using namespace jp;

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

struct MockHal : Hal {
    std::vector<std::vector<uint8_t>> out;
    std::vector<uint8_t> din;
    void dinOut(const uint8_t *m, int n) override { din.insert(din.end(), m, m + n); }
    std::map<int, std::vector<uint8_t>> store;
    uint32_t rgb[16] = {};
    bool led[10] = {};
    int shows = 0;
    bool boot = false;
    void midiOut(const uint8_t *m, int n) override { out.emplace_back(m, m + n); }
    void padRgb(int p, uint32_t c) override { rgb[p] = c; }
    void padShow() override { shows++; }
    void buttonLed(int b, bool on) override { led[b] = on; }
    int storeRead(int key, void *buf, int len) override {
        auto it = store.find(key);
        if (it == store.end() || (int)it->second.size() != len) return -1;
        memcpy(buf, it->second.data(), len);
        return len;
    }
    int storeWrite(int key, const void *buf, int len) override {
        store[key].assign((const uint8_t *)buf, (const uint8_t *)buf + len);
        return len;
    }
    void enterBootloader() override { boot = true; }
    int bt = -1;
    void setBluetooth(bool on) override { bt = on; }
    std::vector<uint8_t> last() { return out.empty() ? std::vector<uint8_t>() : out.back(); }
};

static void feed(Engine &e, const std::vector<uint8_t> &bytes) { for (uint8_t b : bytes) e.midiIn(b); }

static std::vector<uint8_t> sysex(uint8_t cmd, std::vector<uint8_t> payload) {
    std::vector<uint8_t> m = {0xF0, 0x7D, 0x4A, 0x50, cmd};
    m.insert(m.end(), payload.begin(), payload.end());
    m.push_back(0xF7);
    return m;
}

// a hit: rises to `peak` and holds `holdMs`, sampled every 3 ms (about the pad scan rate)
static void hit(Engine &e, int pad, uint16_t peak, uint32_t &t, int holdMs = 30) {
    for (int k = 1; k <= 3; k++) { e.padSample(pad, peak * k / 3, t); t += 3; }
    for (int k = 0; k < holdMs / 3; k++) { e.padSample(pad, peak, t); t += 3; }
    e.padSample(pad, 0, t); t += 3;
}

static void testPacking() {
    uint8_t in[300], packed[400], back[300];
    for (int i = 0; i < 300; i++) in[i] = (uint8_t)(i * 37 + 11);
    size_t n = pack7(in, 300, packed);
    CHECK(n == packedSize(300));
    for (size_t i = 0; i < n; i++) CHECK(packed[i] < 128);
    CHECK(unpack7(packed, n, back) == 300);
    CHECK(memcmp(in, back, 300) == 0);
}

static void testProfileRoundTrip() {
    Profile p, q;
    defaultProfile(p, SIDE_LEFT);
    p.sens.curve = CURVE_CUSTOM;
    p.sens.atMode = AT_POLY;
    p.ctl[CTL_BUTTON0 + 4].type = MSG_CC;
    p.ctl[CTL_BUTTON0 + 4].mode = MODE_TOGGLE;
    uint8_t buf[PROFILE_BYTES];
    serializeProfile(p, buf);
    CHECK(deserializeProfile(buf, q));
    uint8_t buf2[PROFILE_BYTES];
    serializeProfile(q, buf2);
    CHECK(memcmp(buf, buf2, PROFILE_BYTES) == 0);
    buf[0] = 99;
    CHECK(!deserializeProfile(buf, q));
}

static void testGeometry() {
    for (int s = 0; s < 2; s++) {
        Side side = (Side)s;
        for (int p = 0; p < PADS; p++) { int r, c; padPosition(side, p, r, c); CHECK(padAt(side, r, c) == p); }
        for (int k = 0; k < KNOBS; k++) { int r, c; knobPosition(side, k, r, c); CHECK(knobAt(side, r, c) == k); }
        for (int b = 0; b < BUTTONS; b++) CHECK(buttonAt(side, buttonSlot(side, b)) == b);
    }
    int r, c;
    padPosition(SIDE_RIGHT, 0, r, c); CHECK(r == 3 && c == 0);      // bottom-left
    padPosition(SIDE_LEFT, 0, r, c); CHECK(r == 0 && c == 3);       // turned: top-right
}

static void testDefaults() {
    Profile l, r;
    defaultProfile(l, SIDE_LEFT);
    defaultProfile(r, SIDE_RIGHT);
    // knobs: CC = row * 4 + column of the JAMbo 4x4 grid, all 16 numbers used once
    bool used[16] = {};
    for (int k = 0; k < KNOBS; k++) {
        used[l.ctl[CTL_KNOB0 + k].number] = true;
        used[r.ctl[CTL_KNOB0 + k].number] = true;
    }
    for (int i = 0; i < 16; i++) CHECK(used[i]);
    // the left unit's top-left knob is JAMbo's knob 1.1 (CC 0), the right unit's top-right CC 3
    CHECK(l.ctl[CTL_KNOB0 + knobAt(SIDE_LEFT, 0, 0)].number == 0);
    CHECK(r.ctl[CTL_KNOB0 + knobAt(SIDE_RIGHT, 0, 1)].number == 3);
    // pads: 36 at the bottom-left as the unit sits
    CHECK(l.ctl[padAt(SIDE_LEFT, 3, 0)].number == 36);
    CHECK(r.ctl[padAt(SIDE_RIGHT, 0, 3)].number == 51);
}

static void testVelocity() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    uint32_t t = 0;
    hal.out.clear();
    hit(e, 5, 960, t);
    CHECK(hal.out.size() >= 2);
    CHECK(hal.out[0][0] == 0x92 && hal.out[0][2] == 127);           // right unit: channel 3
    CHECK(hal.out.back()[0] == 0x82);
    hal.out.clear();
    hit(e, 5, 555, t);                                              // halfway
    CHECK(hal.out[0][2] == 63 || hal.out[0][2] == 64);
    hal.out.clear();
    hit(e, 5, 100, t);                                              // below the threshold
    CHECK(hal.out.empty());
}

static void testCurves() {
    Sensitivity s;
    Profile p;
    defaultProfile(p, SIDE_RIGHT);
    s = p.sens;
    uint8_t lut[128];
    for (int c = 0; c < CURVE_COUNT; c++) {
        s.curve = (uint8_t)c;
        buildVelocityLut(s, lut);
        for (int x = 1; x < 128; x++) {
            CHECK(lut[x] >= 1 && lut[x] <= 127);
            if (c != CURVE_FIXED && x > 1) CHECK(lut[x] >= lut[x - 1]);   // never falls
        }
        if (c != CURVE_FIXED) { CHECK(lut[1] == 1); CHECK(lut[127] == 127); }
    }
    s.curve = CURVE_LINEAR; s.velMin = 40; s.velMax = 100;
    buildVelocityLut(s, lut);
    CHECK(lut[1] == 40 && lut[127] == 100);
    s.curve = CURVE_FIXED; s.fixedVelocity = 90;
    buildVelocityLut(s, lut);
    CHECK(lut[1] == 90 && lut[127] == 90);
}

static void testGain() {
    Profile p;
    defaultProfile(p, SIDE_RIGHT);
    CHECK(linearVelocity(p.sens, 0, 555) == 63);
    p.sens.padGain[0] = 150;
    CHECK(linearVelocity(p.sens, 0, 555) > 100);
}

static void testKnobs() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    hal.out.clear();
    int k = 0;
    const Control &x = e.activeProfile().ctl[CTL_KNOB0 + k];
    e.knobEvent(k, 1);
    CHECK(hal.last()[0] == (0xB0 | x.channel) && hal.last()[1] == x.number && hal.last()[2] == 1);
    e.knobEvent(k, -5);                             // down to 0
    CHECK(hal.out.size() == 2 && hal.last()[2] == 0);
    e.knobEvent(k, -1);                             // stays at 0: no message
    CHECK(hal.out.size() == 2);
    // the host moves the value (feedback), the knob continues from there
    feed(e, {(uint8_t)(0xB0 | x.channel), x.number, 100});
    e.knobEvent(k, 1);
    CHECK(hal.last()[2] == 101);
    // relative, offset 64
    Profile p = e.activeProfile();
    p.ctl[CTL_KNOB0 + k].mode = KNOB_REL64;
    p.ctl[CTL_KNOB0 + k].c = 2;
    uint8_t raw[PROFILE_BYTES], packed[1000];
    serializeProfile(p, raw);
    size_t n = pack7(raw, PROFILE_BYTES, packed);
    std::vector<uint8_t> pl = {0};
    pl.insert(pl.end(), packed, packed + n);
    feed(e, sysex(CMD_SET_PROFILE, pl));
    CHECK(hal.last()[4] == (CMD_SET_PROFILE | REPLY) && hal.last()[5] == ST_OK);
    e.knobEvent(k, -1);
    CHECK(hal.last()[2] == 62);
}

static void testButtonsAndToggle() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    hal.out.clear();
    e.buttonEvent(5, true, 0);
    CHECK(hal.last()[0] == 0x92 && hal.last()[2] == 127);
    e.buttonEvent(5, false, 10);
    CHECK(hal.last()[0] == 0x82);
    CHECK(!hal.led[5]);
    e.buttonEvent(5, true, 20);
    e.tick(20);
    CHECK(hal.led[5]);
}

static void testFeedbackLeds() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    const Control &x = e.activeProfile().ctl[3];
    feed(e, {(uint8_t)(0x90 | x.channel), x.number, 127});
    e.tick(0);
    CHECK(hal.rgb[3] == paletteRgb(x.c, 127));
    feed(e, {(uint8_t)(0x80 | x.channel), x.number, 0});
    e.tick(0);
    CHECK(hal.rgb[3] == 0);
    const Control &b = e.activeProfile().ctl[CTL_BUTTON0 + 7];
    feed(e, {(uint8_t)(0x90 | b.channel), b.number, 127});
    e.tick(0);
    CHECK(hal.led[7]);
}

static void testSysex() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    hal.out.clear();
    feed(e, sysex(CMD_HELLO, {}));
    auto r = hal.last();
    CHECK(r.size() == 18 && r[4] == (CMD_HELLO | REPLY) && r[5] == ST_OK && r[12] == PROFILES);
    // get -> set the same -> save -> a new engine on the same store reads it back
    feed(e, sysex(CMD_GET_PROFILE, {2}));
    r = hal.last();
    CHECK(r[4] == (CMD_GET_PROFILE | REPLY) && r[6] == 2);
    std::vector<uint8_t> packed(r.begin() + 7, r.end() - 1);
    CHECK(packed.size() == packedSize(PROFILE_BYTES));
    uint8_t raw[PROFILE_BYTES + 8];
    unpack7(packed.data(), packed.size(), raw);
    raw[1] = 'X';                                                   // rename
    uint8_t re[1000];
    size_t n = pack7(raw, PROFILE_BYTES, re);
    std::vector<uint8_t> pl = {2};
    pl.insert(pl.end(), re, re + n);
    feed(e, sysex(CMD_SET_PROFILE, pl));
    CHECK(hal.last()[5] == ST_OK);
    feed(e, sysex(CMD_SAVE, {}));
    CHECK(hal.last()[4] == (CMD_SAVE | REPLY) && hal.last()[5] == ST_OK);
    feed(e, sysex(CMD_SET_SIDE, {SIDE_LEFT}));
    feed(e, sysex(CMD_SELECT, {2}));
    Engine e2(hal);
    e2.begin(0);
    CHECK(e2.device().side == SIDE_LEFT && e2.device().active == 2);
    CHECK(e2.profile(2).name[0] == 'X');
    // a truncated message is refused
    feed(e, sysex(CMD_SET_PROFILE, {1, 2, 3}));
    CHECK(hal.last()[5] == ST_BAD_ARGS);
    // bootloader
    feed(e, sysex(CMD_BOOTLOADER, {}));
    CHECK(hal.boot);
}

static void testMonitorAndIdentify() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    feed(e, sysex(CMD_MONITOR, {1}));
    hal.out.clear();
    e.padSample(4, 700, 0);
    e.tick(40);
    auto r = hal.last();
    CHECK(r[4] == EV_PRESSURE && r.size() == 6 + 32);
    CHECK((r[5 + 8] | r[5 + 9] << 7) == 700);
    feed(e, sysex(CMD_IDENTIFY, {1}));
    hal.out.clear();
    e.knobEvent(3, -1);
    CHECK(hal.last()[4] == EV_IDENTIFY && hal.last()[5] == 2 && hal.last()[6] == 3 && hal.last()[7] == 63);
    e.buttonEvent(2, true, 0);
    CHECK(hal.last()[4] == EV_IDENTIFY && hal.last()[5] == 1);
}

static void testProfileMenu() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    e.buttonEvent(1, true, 0);
    e.buttonEvent(2, true, 0);
    CHECK(e.menuOpen());
    uint32_t t = 0;
    hal.out.clear();
    hit(e, padAt(SIDE_RIGHT, 0, 2), 800, t);        // top row, third pad -> profile 3
    CHECK(e.device().active == 2);
    for (auto &m : hal.out) CHECK(m[0] == 0xF0);     // no notes, only the EV_PROFILE event
    e.buttonEvent(2, false, 0);
    CHECK(!e.menuOpen());
}

static void testAftertouch() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    Profile p = e.activeProfile();
    p.sens.atMode = AT_POLY;
    uint8_t raw[PROFILE_BYTES], packed[1000];
    serializeProfile(p, raw);
    size_t n = pack7(raw, PROFILE_BYTES, packed);
    std::vector<uint8_t> pl = {0};
    pl.insert(pl.end(), packed, packed + n);
    feed(e, sysex(CMD_SET_PROFILE, pl));
    hal.out.clear();
    uint32_t t = 0;
    for (int k = 0; k < 5; k++) { e.padSample(0, 400, t); t += 3; }
    for (int k = 0; k < 10; k++) { e.padSample(0, 400 + k * 50, t); t += 3; }
    bool sawAt = false;
    for (auto &m : hal.out) if ((m[0] & 0xF0) == 0xA0) sawAt = true;
    CHECK(sawAt);
    e.padSample(0, 0, t);
    CHECK((hal.out[hal.out.size() - 2][0] & 0xF0) == 0xA0 && hal.out[hal.out.size() - 2][2] == 0);
}


static void testScales() {
    const int lists[SCALE_COUNT][13] = {
        {0, 2, 4, 5, 7, 9, 11, -1}, {0, 2, 3, 5, 7, 8, 10, -1}, {0, 2, 3, 5, 7, 9, 10, -1}, {0, 1, 3, 5, 7, 8, 10, -1},
        {0, 2, 4, 6, 7, 9, 11, -1}, {0, 2, 4, 5, 7, 9, 10, -1}, {0, 1, 3, 5, 6, 8, 10, -1}, {0, 2, 3, 5, 7, 8, 11, -1},
        {0, 2, 4, 7, 9, -1}, {0, 3, 5, 7, 10, -1}, {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -1},
    };
    for (int i = 0; i < SCALE_COUNT; i++) {
        uint16_t m = 0;
        for (int k = 0; lists[i][k] >= 0; k++) m |= (uint16_t)(1u << lists[i][k]);
        CHECK(SCALE_MASKS[i] == m);
    }
}

static void testKeysNotes() {
    Layer l = {LAYER_KEYS, 3, KEYS_CHROMATIC, 4, 5, 1, 0, 7};
    int kind;
    // C major, octave 3 (as JAMbo: 12 * (3 + 1) + 0 = 48): bottom-left = root
    CHECK(keysNote(l, 0, SCALE_MASKS[0], 3, 3, 0, kind) == 48 && kind == 2);
    CHECK(keysNote(l, 0, SCALE_MASKS[0], 3, 3, 1, kind) == 49 && kind == 0);    // C#: outside
    CHECK(keysNote(l, 0, SCALE_MASKS[0], 3, 3, 2, kind) == 50 && kind == 1);    // D
    CHECK(keysNote(l, 0, SCALE_MASKS[0], 3, 2, 0, kind) == 52 && kind == 1);    // next row: +4
    CHECK(keysNote(l, 0, SCALE_MASKS[0], 3, 0, 0, kind) == 60 && kind == 2);    // top row: C again
    l.layout = KEYS_IN_KEY;
    // A minor, in key: A C... -> A3 (57) B C D / E F G A ...
    CHECK(keysNote(l, 9, SCALE_MASKS[1], 3, 3, 0, kind) == 57 && kind == 2);
    CHECK(keysNote(l, 9, SCALE_MASKS[1], 3, 3, 1, kind) == 59 && kind == 1);
    CHECK(keysNote(l, 9, SCALE_MASKS[1], 3, 3, 2, kind) == 60);
    CHECK(keysNote(l, 9, SCALE_MASKS[1], 3, 2, 3, kind) == 69 && kind == 2);    // degree 7: A an octave up
    CHECK(keysNote(l, 0, SCALE_MASKS[0], 7, 0, 3, kind) == -1 || kind >= 0);    // high octave: stays in range or -1
}

static void sideLeft(MockHal &hal) {
    // a stored LEFT device, so the engine starts with the LEFT defaults
    Device d;
    defaultDevice(d);
    d.side = SIDE_LEFT;
    uint8_t b[DEVICE_BYTES];
    serializeDevice(d, b);
    hal.store[STORE_DEVICE].assign(b, b + DEVICE_BYTES);
}

static void testLayersAndKeys() {
    MockHal hal;
    sideLeft(hal);
    Engine e(hal);
    e.begin(0);
    CHECK(e.layer() == 0);
    // the left unit's top button (slot 0) picks SEQ, slot 1 KEYS
    int keysBtn = buttonAt(SIDE_LEFT, 1);
    e.buttonEvent(keysBtn, true, 0);
    e.buttonEvent(keysBtn, false, 0);
    CHECK(e.layer() == 1);
    CHECK(hal.out.back()[4] == EV_LAYER && hal.out.back()[5] == 1);
    e.tick(0);
    CHECK(hal.led[keysBtn]);
    // the app sends A minor, octave 2
    feed(e, sysex(CMD_SET_SCALE, {9, (uint8_t)(SCALE_MASKS[1] & 0x7F), (uint8_t)(SCALE_MASKS[1] >> 7), 2}));
    CHECK(e.root() == 9 && e.scaleMask() == SCALE_MASKS[1] && e.octave() == 2);
    e.tick(0);
    int bl = padAt(SIDE_LEFT, 3, 0);                    // bottom-left as the unit sits: the root
    CHECK(hal.rgb[bl] == paletteRgb(5, 127));
    CHECK(hal.rgb[padAt(SIDE_LEFT, 3, 1)] == paletteRgb(0, 12));     // A#: outside, off
    hal.out.clear();
    uint32_t t = 0;
    for (int k = 0; k < 5; k++) { e.padSample(bl, 900, t); t += 3; }
    CHECK(hal.out[0][0] == 0x93 && hal.out[0][1] == 12 * 3 + 9);     // KEYS on channel 4: A2 = 45
    // octave changes while the pad is held: the note off still matches the note on
    feed(e, sysex(CMD_SET_SCALE, {9, (uint8_t)(SCALE_MASKS[1] & 0x7F), (uint8_t)(SCALE_MASKS[1] >> 7), 4}));
    e.padSample(bl, 0, t);
    CHECK(hal.out.back()[0] == 0x83 && hal.out.back()[1] == 45);
    // MUTE layer (slot 2): notes on channel 5
    e.buttonEvent(buttonAt(SIDE_LEFT, 2), true, 0);
    hal.out.clear();
    for (int k = 0; k < 5; k++) { e.padSample(bl, 900, t); t += 3; }
    CHECK(hal.out[0][0] == 0x94 && hal.out[0][1] == 36);
    // host feedback lights the MUTE layer's pad in red
    feed(e, {0x94, 37, 127});
    e.padSample(bl, 0, t);
    e.tick(0);
    CHECK(hal.rgb[padAt(SIDE_LEFT, 3, 1)] == paletteRgb(2, 127));
}

static void testRootPick() {
    MockHal hal;
    sideLeft(hal);
    Engine e(hal);
    e.begin(0);
    // make the left unit's LFO1 button (slot 4) a ROOT button
    Profile p = e.activeProfile();
    int b = buttonAt(SIDE_LEFT, 4);
    p.ctl[CTL_BUTTON0 + b] = Control{MSG_ACTION, 0, ACT_ROOT, 0, 0, 0, 0, 0};
    uint8_t raw[PROFILE_BYTES], packed[1000];
    serializeProfile(p, raw);
    size_t n = pack7(raw, PROFILE_BYTES, packed);
    std::vector<uint8_t> pl = {0};
    pl.insert(pl.end(), packed, packed + n);
    feed(e, sysex(CMD_SET_PROFILE, pl));
    e.buttonEvent(b, true, 0);
    CHECK(e.pickingRoot());
    e.tick(0);
    CHECK(hal.rgb[padAt(SIDE_LEFT, 3, 0)] == paletteRgb(5, 127));      // C is the root: lit
    CHECK(hal.rgb[padAt(SIDE_LEFT, 0, 0)] == 0);                       // top row: unused
    hal.out.clear();
    uint32_t t = 0;
    int g = padAt(SIDE_LEFT, 2, 3);                                    // second row from the bottom, last: 4 + 3 = G
    for (int k = 0; k < 5; k++) { e.padSample(g, 900, t); t += 3; }
    e.padSample(g, 0, t);
    CHECK(e.root() == 7);
    CHECK(hal.out.size() == 1 && hal.out[0][4] == EV_ROOT && hal.out[0][5] == 7);   // no notes, the event
    e.buttonEvent(b, false, 0);
    CHECK(!e.pickingRoot());
    // KEYS now starts on G
    e.buttonEvent(buttonAt(SIDE_LEFT, 1), true, 0);
    hal.out.clear();
    int bl = padAt(SIDE_LEFT, 3, 0);
    for (int k = 0; k < 5; k++) { e.padSample(bl, 900, t); t += 3; }
    CHECK(hal.out[0][0] == 0x93 && hal.out[0][1] == 12 * 4 + 7);
}

static void testBluetoothAndProfileButtons() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    CHECK(hal.bt == 1);                                         // on by default
    Profile p = e.activeProfile();
    p.ctl[CTL_BUTTON0 + 0] = Control{MSG_ACTION, 0, ACT_BLUETOOTH, 0, 0, 0, 0, 0};
    p.ctl[CTL_BUTTON0 + 1] = Control{MSG_ACTION, 0, ACT_PROFILE, 0, 2, 0, 0, 0};
    uint8_t raw[PROFILE_BYTES], packed[1000];
    serializeProfile(p, raw);
    size_t n = pack7(raw, PROFILE_BYTES, packed);
    std::vector<uint8_t> pl = {0};
    pl.insert(pl.end(), packed, packed + n);
    feed(e, sysex(CMD_SET_PROFILE, pl));
    e.tick(0);
    CHECK(hal.led[0]);                                          // BT on: lit
    e.buttonEvent(0, true, 0);
    e.buttonEvent(0, false, 0);
    CHECK(hal.bt == 0 && e.device().ble == 0);
    e.tick(0);
    CHECK(!hal.led[0]);
    e.buttonEvent(1, true, 0);                                  // profile 3
    CHECK(e.device().active == 2);
    feed(e, sysex(CMD_SET_BLUETOOTH, {1}));
    CHECK(hal.bt == 1);
    Engine e2(hal);
    e2.begin(0);
    CHECK(e2.device().ble == 1 && e2.device().active == 2);
}

static void testPortsDoNotMix() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    hal.out.clear();
    // a settings SysEx over Bluetooth, with USB notes arriving in the middle of it
    auto m = sysex(CMD_HELLO, {});
    for (size_t i = 0; i < m.size(); i++) {
        e.midiIn(m[i], Engine::PORT_BLE_CFG);
        if (i == 2) for (uint8_t b : {0x92, 37, 127}) e.midiIn(b, Engine::PORT_USB);
    }
    CHECK(!hal.out.empty() && hal.out.back()[4] == (CMD_HELLO | REPLY));
    // the settings service does not go to MIDI OUT
    hal.din.clear();
    for (uint8_t b : {0xF8, 0xFA}) e.midiIn(b, Engine::PORT_BLE_CFG);
    CHECK(hal.din.empty());
    for (uint8_t b : {0xF8}) e.midiIn(b, Engine::PORT_BLE_MIDI);
    CHECK(hal.din.size() == 1);
}

static void testFollowHostOff() {
    MockHal hal;
    sideLeft(hal);
    Engine e(hal);
    e.begin(0);
    Profile p = e.activeProfile();
    p.keys.followHost = 0;
    p.keys.root = 2;
    uint8_t raw[PROFILE_BYTES], packed[1000];
    serializeProfile(p, raw);
    size_t n = pack7(raw, PROFILE_BYTES, packed);
    std::vector<uint8_t> pl = {0};
    pl.insert(pl.end(), packed, packed + n);
    feed(e, sysex(CMD_SET_PROFILE, pl));
    CHECK(hal.last()[5] == ST_OK);
    feed(e, sysex(CMD_SET_SCALE, {9, 0x7F, 0x1F, 2}));
    CHECK(e.root() == 2);
}

static void testThru() {
    MockHal hal;
    Engine e(hal);
    e.begin(0);
    CHECK(e.device().thru == THRU_CLOCK);
    feed(e, {0xFA, 0xF8, 0xF8, 0xFE, 0x90, 60, 100, 0xFC});
    CHECK((hal.din == std::vector<uint8_t>{0xFA, 0xF8, 0xF8, 0xFC}));
    hal.din.clear();
    feed(e, sysex(CMD_SET_MIDI_OUT, {THRU_ALL, 1}));
    CHECK(hal.last()[5] == ST_OK);
    feed(e, {0x90, 60, 100, 0xF8, 61, 0});              // running status with a clock in between
    CHECK((hal.din == std::vector<uint8_t>{0x90, 60, 100, 0xF8, 0x90, 61, 0}));
    hal.din.clear();
    feed(e, sysex(CMD_HELLO, {}));                      // our own SysEx does not go out
    CHECK(hal.din.empty());
    feed(e, {0xF0, 0x41, 0x10, 0xF7});                  // someone else's does
    CHECK(hal.din.size() == 4);
    hal.din.clear();
    e.knobEvent(0, 1);                                  // the controls' own messages too
    CHECK(hal.din.size() == 3 && (hal.din[0] & 0xF0) == 0xB0);
    Engine e2(hal);
    e2.begin(0);
    CHECK(e2.device().thru == THRU_ALL && e2.device().controlsOut == 1);
}

static void writeVectors(const char *path) {
    FILE *f = std::fopen(path, "w");
    if (!f) { std::printf("cannot write %s\n", path); failures++; return; }
    std::fprintf(f, "{\n  \"profileBytes\": %d,\n", PROFILE_BYTES);
    for (int s = 0; s < 2; s++) {
        Profile p;
        defaultProfile(p, (Side)s);
        uint8_t buf[PROFILE_BYTES];
        serializeProfile(p, buf);
        std::fprintf(f, "  \"default%s\": [", s ? "Left" : "Right");
        for (int i = 0; i < PROFILE_BYTES; i++) std::fprintf(f, "%s%d", i ? "," : "", buf[i]);
        std::fprintf(f, "],\n");
    }
    Profile p;
    defaultProfile(p, SIDE_RIGHT);
    Sensitivity s = p.sens;
    s.velMin = 10; s.velMax = 120; s.fixedVelocity = 77;
    const uint8_t custom[5] = {0, 90, 100, 110, 127};
    memcpy(s.custom, custom, 5);
    std::fprintf(f, "  \"lutSens\": {\"velMin\": 10, \"velMax\": 120, \"fixedVelocity\": 77, \"custom\": [0,90,100,110,127]},\n");
    std::fprintf(f, "  \"luts\": [\n");
    for (int c = 0; c < CURVE_COUNT; c++) {
        s.curve = (uint8_t)c;
        uint8_t lut[128];
        buildVelocityLut(s, lut);
        std::fprintf(f, "    [");
        for (int i = 0; i < 128; i++) std::fprintf(f, "%s%d", i ? "," : "", lut[i]);
        std::fprintf(f, "]%s\n", c + 1 < CURVE_COUNT ? "," : "");
    }
    std::fprintf(f, "  ],\n  \"keys\": [");
    // [layout, rowStep, root, scale, octave, row, col] -> note, kind
    bool first = true;
    for (int layout = 0; layout < 2; layout++)
        for (int sc = 0; sc < SCALE_COUNT; sc += 3)
            for (int pad = 0; pad < PADS; pad += 5) {
                Layer l = {LAYER_KEYS, 0, (uint8_t)layout, (uint8_t)(layout ? 3 : 5), 0, 0, 0, 0};
                int row = pad / 4, col = pad % 4, kind;
                int note = keysNote(l, 7, SCALE_MASKS[sc], 2, row, col, kind);
                std::fprintf(f, "%s[%d,%d,7,%d,2,%d,%d,%d,%d]", first ? "" : ",", layout, l.rowStep, sc, row, col, note, kind);
                first = false;
            }
    std::fprintf(f, "]\n}\n");
    std::fclose(f);
}

int main(int argc, char **argv) {
    testPacking();
    testProfileRoundTrip();
    testGeometry();
    testDefaults();
    testVelocity();
    testCurves();
    testGain();
    testKnobs();
    testButtonsAndToggle();
    testFeedbackLeds();
    testSysex();
    testMonitorAndIdentify();
    testProfileMenu();
    testAftertouch();
    testScales();
    testKeysNotes();
    testLayersAndKeys();
    testFollowHostOff();
    testRootPick();
    testBluetoothAndProfileButtons();
    testPortsDoNotMix();
    testThru();
    if (argc > 1) writeVectors(argv[1]);
    std::printf(failures ? "%d FAILED\n" : "all tests passed\n", failures);
    return failures ? 1 : 0;
}
