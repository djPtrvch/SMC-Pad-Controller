#include "jp_config.h"
#include <string.h>
#include <math.h>

namespace jp {

static uint8_t clampU8(int v, int lo, int hi) { return (uint8_t)(v < lo ? lo : v > hi ? hi : v); }
static uint16_t clampU16(int v, int lo, int hi) { return (uint16_t)(v < lo ? lo : v > hi ? hi : v); }

// ------------------------------------------------------------------ byte layout

void serializeProfile(const Profile &p, uint8_t *o) {
    int i = 0;
    o[i++] = FORMAT_VERSION;
    for (int k = 0; k < NAME_LEN; k++) o[i++] = (uint8_t)p.name[k] & 0x7F;
    const Sensitivity &s = p.sens;
    o[i++] = s.onThreshold & 0xFF;  o[i++] = s.onThreshold >> 8;
    o[i++] = s.offThreshold & 0xFF; o[i++] = s.offThreshold >> 8;
    o[i++] = s.fullScale & 0xFF;    o[i++] = s.fullScale >> 8;
    o[i++] = s.attackMs;
    o[i++] = s.curve;
    o[i++] = s.velMin;
    o[i++] = s.velMax;
    o[i++] = s.fixedVelocity;
    for (int k = 0; k < 5; k++) o[i++] = s.custom[k];
    o[i++] = s.atMode;
    o[i++] = s.atThreshold & 0xFF;  o[i++] = s.atThreshold >> 8;
    o[i++] = s.atIntervalMs;
    for (int k = 0; k < PADS; k++) o[i++] = s.padGain[k];
    for (int c = 0; c < CONTROLS; c++) {
        const Control &x = p.ctl[c];
        o[i++] = x.type; o[i++] = x.channel; o[i++] = x.number; o[i++] = x.mode;
        o[i++] = x.a; o[i++] = x.b; o[i++] = x.c; o[i++] = x.d;
    }
    o[i++] = p.ledMode;
}

bool deserializeProfile(const uint8_t *in, Profile &p) {
    if (in[0] != FORMAT_VERSION) return false;
    int i = 1;
    for (int k = 0; k < NAME_LEN; k++) p.name[k] = (char)(in[i++] & 0x7F);
    Sensitivity &s = p.sens;
    s.onThreshold = in[i] | in[i + 1] << 8; i += 2;
    s.offThreshold = in[i] | in[i + 1] << 8; i += 2;
    s.fullScale = in[i] | in[i + 1] << 8; i += 2;
    s.attackMs = in[i++];
    s.curve = in[i++];
    s.velMin = in[i++];
    s.velMax = in[i++];
    s.fixedVelocity = in[i++];
    for (int k = 0; k < 5; k++) s.custom[k] = in[i++];
    s.atMode = in[i++];
    s.atThreshold = in[i] | in[i + 1] << 8; i += 2;
    s.atIntervalMs = in[i++];
    for (int k = 0; k < PADS; k++) s.padGain[k] = in[i++];
    for (int c = 0; c < CONTROLS; c++) {
        Control &x = p.ctl[c];
        x.type = in[i++]; x.channel = in[i++]; x.number = in[i++]; x.mode = in[i++];
        x.a = in[i++]; x.b = in[i++]; x.c = in[i++]; x.d = in[i++];
    }
    p.ledMode = in[i++];
    sanitize(p);
    return true;
}

void serializeDevice(const Device &d, uint8_t *o) {
    o[0] = FORMAT_VERSION;
    o[1] = d.side;
    o[2] = d.active;
}

bool deserializeDevice(const uint8_t *in, Device &d) {
    if (in[0] != FORMAT_VERSION) return false;
    d.side = in[1] == SIDE_LEFT ? SIDE_LEFT : SIDE_RIGHT;
    d.active = in[2] < PROFILES ? in[2] : 0;
    return true;
}

void sanitize(Profile &p) {
    for (int k = 0; k < NAME_LEN; k++) {
        char c = p.name[k];
        if (c != 0 && (c < 32 || c > 126)) p.name[k] = '_';
    }
    Sensitivity &s = p.sens;
    s.onThreshold = clampU16(s.onThreshold, 20, 1000);
    s.offThreshold = clampU16(s.offThreshold, 10, s.onThreshold - 5);
    s.fullScale = clampU16(s.fullScale, s.onThreshold + 20, 1023);
    s.attackMs = clampU8(s.attackMs, 1, 40);
    if (s.curve >= CURVE_COUNT) s.curve = CURVE_LINEAR;
    s.velMin = clampU8(s.velMin, 1, 127);
    s.velMax = clampU8(s.velMax, s.velMin, 127);
    s.fixedVelocity = clampU8(s.fixedVelocity, 1, 127);
    for (int k = 0; k < 5; k++) s.custom[k] = clampU8(s.custom[k], 0, 127);
    if (s.atMode > AT_POLY) s.atMode = AT_OFF;
    s.atThreshold = clampU16(s.atThreshold, s.onThreshold, s.fullScale - 10);
    s.atIntervalMs = clampU8(s.atIntervalMs, 2, 100);
    for (int k = 0; k < PADS; k++) s.padGain[k] = clampU8(s.padGain[k], 50, 200);
    for (int c = 0; c < CONTROLS; c++) {
        Control &x = p.ctl[c];
        if (x.type > MSG_PC) x.type = MSG_OFF;
        x.channel &= 0x0F;
        x.number &= 0x7F;
        if (c >= PADS + BUTTONS) {
            if (x.type == MSG_PC || x.type == MSG_NOTE) x.type = MSG_CC;     // knobs send CC
            if (x.mode > KNOB_RELSIGN) x.mode = KNOB_ABS;
            x.a &= 0x7F; x.b &= 0x7F;
            x.c = clampU8(x.c, 1, 16);
            x.d = 0;
        } else {
            if (x.mode > MODE_TOGGLE) x.mode = MODE_MOMENTARY;
            x.a &= 0x0F; x.b &= 0x0F; x.c &= 0x0F; x.d = 0;
        }
    }
    if (p.ledMode > LED_BOTH) p.ledMode = LED_BOTH;
}

// ------------------------------------------------------------------ 8-to-7 packing

size_t packedSize(size_t n) { return n + (n + 6) / 7; }

size_t pack7(const uint8_t *in, size_t n, uint8_t *out) {
    size_t o = 0;
    for (size_t i = 0; i < n; i += 7) {
        size_t len = n - i < 7 ? n - i : 7;
        uint8_t hi = 0;
        for (size_t k = 0; k < len; k++) hi |= (uint8_t)((in[i + k] >> 7) << k);
        out[o++] = hi;
        for (size_t k = 0; k < len; k++) out[o++] = in[i + k] & 0x7F;
    }
    return o;
}

size_t unpack7(const uint8_t *in, size_t n, uint8_t *out) {
    size_t o = 0;
    for (size_t i = 0; i < n; i += 8) {
        size_t len = n - i < 8 ? n - i : 8;
        if (len < 2) break;
        uint8_t hi = in[i];
        for (size_t k = 1; k < len; k++) out[o++] = (uint8_t)((in[i + k] & 0x7F) | (((hi >> (k - 1)) & 1) << 7));
    }
    return o;
}

// ------------------------------------------------------------------ geometry
// RIGHT (as the unit comes): pad 0 bottom-left, rows upwards; knobs 2 columns x 4 rows, knob 0
// bottom-left; buttons in panel order. LEFT: the same turned by 180 degrees.

void padPosition(Side side, int pad, int &row, int &col) {
    row = 3 - pad / 4;
    col = pad % 4;
    if (side == SIDE_LEFT) { row = 3 - row; col = 3 - col; }
}

int padAt(Side side, int row, int col) {
    if (side == SIDE_LEFT) { row = 3 - row; col = 3 - col; }
    return (3 - row) * 4 + col;
}

void knobPosition(Side side, int knob, int &row, int &col) {
    row = 3 - knob / 2;
    col = knob % 2;
    if (side == SIDE_LEFT) { row = 3 - row; col = 1 - col; }
}

int knobAt(Side side, int row, int col) {
    if (side == SIDE_LEFT) { row = 3 - row; col = 1 - col; }
    return (3 - row) * 2 + col;
}

int buttonSlot(Side side, int button) { return side == SIDE_LEFT ? BUTTONS - 1 - button : button; }
int buttonAt(Side side, int slot) { return side == SIDE_LEFT ? BUTTONS - 1 - slot : slot; }

// ------------------------------------------------------------------ defaults
// JAMbo: 16 knobs = its 4x4 knob grid, CC row * 4 + column on channel 1 (its TWISTER PRESET);
// the left unit holds columns 1-2, the right one 3-4. Pads: notes 36..51 from the bottom-left,
// buttons: notes 0..9 in slot order; left unit on channel 2, right on channel 3.

void defaultDevice(Device &d) {
    d.side = SIDE_RIGHT;
    d.active = 0;
}

void defaultProfile(Profile &p, Side side) {
    memset(&p, 0, sizeof p);
    const char *name = side == SIDE_LEFT ? "JAMbo L" : "JAMbo R";
    strncpy(p.name, name, NAME_LEN);
    Sensitivity &s = p.sens;
    s.onThreshold = 150;
    s.offThreshold = 80;
    s.fullScale = 960;
    s.attackMs = 9;
    s.curve = CURVE_LINEAR;
    s.velMin = 1;
    s.velMax = 127;
    s.fixedVelocity = 100;
    const uint8_t custom[5] = {0, 32, 64, 96, 127};
    memcpy(s.custom, custom, 5);
    s.atMode = AT_OFF;
    s.atThreshold = 300;
    s.atIntervalMs = 10;
    for (int k = 0; k < PADS; k++) s.padGain[k] = 100;

    uint8_t ch = side == SIDE_LEFT ? 1 : 2;
    for (int pad = 0; pad < PADS; pad++) {
        int row, col;
        padPosition(side, pad, row, col);
        Control &x = p.ctl[pad];
        x.type = MSG_NOTE; x.channel = ch; x.number = (uint8_t)(36 + (3 - row) * 4 + col);
        x.mode = MODE_MOMENTARY;
        x.a = 0;        // idle: off
        x.b = 1;        // pressed: white
        x.c = 5;        // host: yellow
    }
    for (int b = 0; b < BUTTONS; b++) {
        Control &x = p.ctl[PADS + b];
        x.type = MSG_NOTE; x.channel = ch; x.number = (uint8_t)buttonSlot(side, b);
        x.mode = MODE_MOMENTARY;
    }
    for (int k = 0; k < KNOBS; k++) {
        int row, col;
        knobPosition(side, k, row, col);
        int gridCol = (side == SIDE_LEFT ? 0 : 2) + col;
        Control &x = p.ctl[PADS + BUTTONS + k];
        x.type = MSG_CC; x.channel = 0; x.number = (uint8_t)(row * 4 + gridCol);
        x.mode = KNOB_ABS; x.a = 0; x.b = 127; x.c = 1;
    }
    p.ledMode = LED_BOTH;
}

// ------------------------------------------------------------------ velocity

static double curveValue(const Sensitivity &s, double u) {     // u 0..1 -> 0..1
    switch (s.curve) {
        case CURVE_SOFT: return sqrt(u);
        case CURVE_HARD: return u * u;
        case CURVE_EXP: return (exp(3.0 * u) - 1.0) / (exp(3.0) - 1.0);
        case CURVE_LOG: return log(1.0 + 9.0 * u) / log(10.0);
        case CURVE_SCURVE: return u * u * (3.0 - 2.0 * u);
        case CURVE_CUSTOM: {
            double x = u * 4.0;
            int k = (int)x;
            if (k >= 4) return s.custom[4] / 127.0;
            double f = x - k;
            return (s.custom[k] + (s.custom[k + 1] - s.custom[k]) * f) / 127.0;
        }
        default: return u;
    }
}

void buildVelocityLut(const Sensitivity &s, uint8_t lut[128]) {
    lut[0] = 0;
    for (int x = 1; x < 128; x++) {
        int v;
        if (s.curve == CURVE_FIXED) {
            v = s.fixedVelocity;
        } else {
            double u = (x - 1) / 126.0;
            double y = curveValue(s, u);
            v = (int)floor(s.velMin + y * (s.velMax - s.velMin) + 0.5);
        }
        lut[x] = clampU8(v, 1, 127);
    }
}

uint8_t linearVelocity(const Sensitivity &s, int pad, uint16_t peak) {
    long p = (long)peak * s.padGain[pad] / 100;
    long v = (p - s.onThreshold) * 127 / (s.fullScale - s.onThreshold);
    return clampU8((int)v, 1, 127);
}

uint8_t pressureLevel(const Sensitivity &s, int pad, uint16_t raw) {
    long p = (long)raw * s.padGain[pad] / 100;
    if (p <= s.atThreshold) return 0;
    long v = (p - s.atThreshold) * 127 / (s.fullScale - s.atThreshold);
    return clampU8((int)v, 0, 127);
}

// ------------------------------------------------------------------ colours

static const uint32_t PALETTE[16] = {
    0x000000, 0xFFFFFF, 0xFF0000, 0xFF4000, 0xFF8000, 0xFFC000, 0x80FF00, 0x00FF00,
    0x00FF80, 0x00FFFF, 0x0080FF, 0x0000FF, 0x4000FF, 0x8000FF, 0xFF00FF, 0xFF0080,
};

uint32_t paletteRgb(uint8_t index, uint8_t level) {
    uint32_t c = PALETTE[index & 15];
    if (level > 127) level = 127;
    uint32_t r = ((c >> 16) & 0xFF) * level / 127, g = ((c >> 8) & 0xFF) * level / 127, b = (c & 0xFF) * level / 127;
    return r << 16 | g << 8 | b;
}

}  // namespace jp
