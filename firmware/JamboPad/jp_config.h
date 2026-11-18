// JamboPad: settings, profiles, their byte layout, velocity curves and the unit's geometry.
// Portable C++ (no Arduino): built by the sketch and by the host tests (tests/host).
// The byte layout is the one in docs/sysex.md; web/src/protocol.ts reads and writes the same bytes.
#pragma once
#include <stdint.h>
#include <stddef.h>

namespace jp {

static const uint8_t FW_MAJOR = 0, FW_MINOR = 1, FW_PATCH = 0;
static const uint8_t FORMAT_VERSION = 1;

static const int PADS = 16, BUTTONS = 10, KNOBS = 8;
static const int CONTROLS = PADS + BUTTONS + KNOBS;     // pads 0..15, buttons 16..25, knobs 26..33
static const int PROFILES = 4;
static const int NAME_LEN = 12;

// Physical numbering (open-smc-pad core): pads 0 = bottom-left, row by row upwards;
// buttons 0..9 in panel order: BLUETOOTH, PAD_BANK, KNOB_BANK, LEFT, RIGHT, PLAY, PAUSE, REC,
// SHIFT, NOTE_REPEAT; knobs 0..7 = knobs 1..8 (row by row from the bottom, left knob first).
enum Side : uint8_t { SIDE_RIGHT = 0, SIDE_LEFT = 1 };      // LEFT = the unit turned by 180 degrees

enum MsgType : uint8_t { MSG_OFF = 0, MSG_NOTE = 1, MSG_CC = 2, MSG_PC = 3 };
enum ButtonMode : uint8_t { MODE_MOMENTARY = 0, MODE_TOGGLE = 1 };
enum KnobMode : uint8_t { KNOB_ABS = 0, KNOB_REL64 = 1, KNOB_REL2C = 2, KNOB_RELSIGN = 3 };
enum Curve : uint8_t {
    CURVE_LINEAR = 0, CURVE_SOFT, CURVE_HARD, CURVE_EXP, CURVE_LOG, CURVE_SCURVE, CURVE_FIXED, CURVE_CUSTOM,
    CURVE_COUNT
};
enum AftertouchMode : uint8_t { AT_OFF = 0, AT_CHANNEL = 1, AT_POLY = 2 };
enum LedMode : uint8_t { LED_LOCAL = 0, LED_HOST = 1, LED_BOTH = 2 };

// One control (8 bytes on the wire). Meaning of a..d:
//   pad     a = idle colour, b = pressed colour, c = host colour (palette 0..15), d = 0
//   button  a..d = 0
//   knob    a = min, b = max (min > max: inverted), c = speed (steps per detent, 1..16), d = 0
struct Control {
    uint8_t type, channel, number, mode;    // channel 0..15; mode: ButtonMode (pads, buttons) or KnobMode
    uint8_t a, b, c, d;
};

struct Sensitivity {
    uint16_t onThreshold;       // raw 0..1023: a hit starts above it (stock 150)
    uint16_t offThreshold;      // raw: the pad is released below it (stock 80)
    uint16_t fullScale;         // raw peak for velocity 127 (stock 960)
    uint8_t attackMs;           // the peak is looked for this long after the threshold (1..40)
    uint8_t curve;              // Curve
    uint8_t velMin, velMax;     // output range 1..127
    uint8_t fixedVelocity;      // CURVE_FIXED
    uint8_t custom[5];          // CURVE_CUSTOM: output at input 0, 25, 50, 75, 100 % (0..127)
    uint8_t atMode;             // AftertouchMode
    uint16_t atThreshold;       // raw: pressure above it is aftertouch
    uint8_t atIntervalMs;       // at most one aftertouch message per pad this often (2..100)
    uint8_t padGain[PADS];      // percent 50..200, per physical pad (calibration)
};

struct Profile {
    char name[NAME_LEN];
    Sensitivity sens;
    Control ctl[CONTROLS];      // physical order: pads, buttons, knobs
    uint8_t ledMode;            // LedMode
};

struct Device {
    uint8_t side;               // Side
    uint8_t active;             // active profile 0..3
};

// ------------------------------------------------------------------ byte layout
static const int PROFILE_BYTES = 322;   // see docs/sysex.md
static const int DEVICE_BYTES = 3;
void serializeProfile(const Profile &p, uint8_t out[PROFILE_BYTES]);
bool deserializeProfile(const uint8_t in[PROFILE_BYTES], Profile &p);   // false: bad version
void serializeDevice(const Device &d, uint8_t out[DEVICE_BYTES]);
bool deserializeDevice(const uint8_t in[DEVICE_BYTES], Device &d);
void sanitize(Profile &p);              // clamps every field into its range

// MIDI-safe 8-to-7 packing (each 7 bytes -> a byte of high bits, then the 7 low parts)
size_t packedSize(size_t n);
size_t pack7(const uint8_t *in, size_t n, uint8_t *out);
size_t unpack7(const uint8_t *in, size_t n, uint8_t *out);     // returns bytes written

// ------------------------------------------------------------------ defaults
void defaultProfile(Profile &p, Side side);
void defaultDevice(Device &d);

// ------------------------------------------------------------------ velocity
// lut[x] for x = 1..127 (the linear velocity from the peak) -> output velocity 1..127; lut[0] = 0.
void buildVelocityLut(const Sensitivity &s, uint8_t lut[128]);
// linear velocity 1..127 from a raw peak (per-pad gain applied)
uint8_t linearVelocity(const Sensitivity &s, int pad, uint16_t peak);
// aftertouch 0..127 from raw pressure (per-pad gain applied)
uint8_t pressureLevel(const Sensitivity &s, int pad, uint16_t raw);

// ------------------------------------------------------------------ geometry
// Visual position as the unit sits on the desk (row 0 = top, column 0 = left), with the
// side's rotation. Pads: 4x4; knobs: 4 rows x 2 columns; buttons: one line of 10 (index 0 = first).
void padPosition(Side side, int pad, int &row, int &col);
int padAt(Side side, int row, int col);
void knobPosition(Side side, int knob, int &row, int &col);
int knobAt(Side side, int row, int col);
int buttonSlot(Side side, int button);
int buttonAt(Side side, int slot);

// ------------------------------------------------------------------ colours
uint32_t paletteRgb(uint8_t index, uint8_t level);    // index 0..15, level 0..127 -> 0xRRGGBB

}  // namespace jp
