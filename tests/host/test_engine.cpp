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
    p.ctl[20].type = MSG_CC;
    p.ctl[20].mode = MODE_TOGGLE;
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
        used[l.ctl[PADS + BUTTONS + k].number] = true;
        used[r.ctl[PADS + BUTTONS + k].number] = true;
    }
    for (int i = 0; i < 16; i++) CHECK(used[i]);
    // the left unit's top-left knob is JAMbo's knob 1.1 (CC 0), the right unit's top-right CC 3
    CHECK(l.ctl[PADS + BUTTONS + knobAt(SIDE_LEFT, 0, 0)].number == 0);
    CHECK(r.ctl[PADS + BUTTONS + knobAt(SIDE_RIGHT, 0, 1)].number == 3);
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
    const Control &x = e.activeProfile().ctl[PADS + BUTTONS + k];
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
    p.ctl[PADS + BUTTONS + k].mode = KNOB_REL64;
    p.ctl[PADS + BUTTONS + k].c = 2;
    uint8_t raw[PROFILE_BYTES], packed[400];
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
    const Control &b = e.activeProfile().ctl[PADS + 7];
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
    CHECK(r.size() == 14 && r[4] == (CMD_HELLO | REPLY) && r[5] == ST_OK && r[12] == PROFILES);
    // get -> set the same -> save -> a new engine on the same store reads it back
    feed(e, sysex(CMD_GET_PROFILE, {2}));
    r = hal.last();
    CHECK(r[4] == (CMD_GET_PROFILE | REPLY) && r[6] == 2);
    std::vector<uint8_t> packed(r.begin() + 7, r.end() - 1);
    CHECK(packed.size() == packedSize(PROFILE_BYTES));
    uint8_t raw[PROFILE_BYTES + 8];
    unpack7(packed.data(), packed.size(), raw);
    raw[1] = 'X';                                                   // rename
    uint8_t re[400];
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
    uint8_t raw[PROFILE_BYTES], packed[400];
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
    std::fprintf(f, "  ]\n}\n");
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
    if (argc > 1) writeVectors(argv[1]);
    std::printf(failures ? "%d FAILED\n" : "all tests passed\n", failures);
    return failures ? 1 : 0;
}
