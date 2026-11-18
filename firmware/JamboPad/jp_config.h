// JamboPad: settings, profiles, their byte layout, velocity curves, scales and the unit's geometry.
// Portable C++ (no Arduino): built by the sketch and by the host tests (tests/host).
// The byte layout is the one in docs/sysex.md; web/src/protocol.ts reads and writes the same bytes.
#pragma once
#include <stdint.h>
#include <stddef.h>

namespace jp {

static const uint8_t FW_MAJOR = 0, FW_MINOR = 6, FW_PATCH = 0;
static const uint8_t FORMAT_VERSION = 3;

static const int PADS = 16, BUTTONS = 10, KNOBS = 8;
// pad banks ("layers" in the code): up to one per button
static const int LAYERS = 10;
// control index: layer L's pads L*16 .. L*16+15, then buttons, then knobs
static const int CTL_BUTTON0 = LAYERS * PADS;               // 160
static const int CTL_KNOB0 = CTL_BUTTON0 + BUTTONS;         // 74
static const int CONTROLS = CTL_KNOB0 + KNOBS;              // 82
static const int PROFILES = 4;
static const int NAME_LEN = 12;

// Physical numbering (open-smc-pad core, checked on the photo of the unit): pads 0 = bottom-left,
// row by row upwards; buttons 0..9 top to bottom: BT, PAD BANK, KNOB BANK, <, >, PLAY, PAUSE,
// REC, SHIFT, NOTE REPEAT; knobs 0..7 = knobs 1..8, row by row from the bottom, left knob first.
enum Side : uint8_t { SIDE_RIGHT = 0, SIDE_LEFT = 1 };      // LEFT = the unit turned by 180 degrees

enum MsgType : uint8_t { MSG_OFF = 0, MSG_NOTE = 1, MSG_CC = 2, MSG_PC = 3, MSG_ACTION = 4 };   // ACTION: buttons only
// number = action, a = layer. ROOT: while held, the 12 lowest pads pick the key note (C..B)
// BLUETOOTH: Bluetooth on / off. PROFILE: a = profile (bank) 0..3.
// SCALE: while held, the 11 lowest pads pick the scale (JAMbo's list, from the bottom-left)
enum Action : uint8_t { ACT_LAYER = 0, ACT_OCT_UP = 1, ACT_OCT_DOWN = 2, ACT_ROOT = 3, ACT_BLUETOOTH = 4, ACT_PROFILE = 5, ACT_SCALE = 6, ACT_COUNT };
enum ButtonMode : uint8_t { MODE_MOMENTARY = 0, MODE_TOGGLE = 1 };
enum KnobMode : uint8_t { KNOB_ABS = 0, KNOB_REL64 = 1, KNOB_REL2C = 2, KNOB_RELSIGN = 3 };
enum Curve : uint8_t {
    CURVE_LINEAR = 0, CURVE_SOFT, CURVE_HARD, CURVE_EXP, CURVE_LOG, CURVE_SCURVE, CURVE_FIXED, CURVE_CUSTOM,
    CURVE_COUNT
};
enum AftertouchMode : uint8_t { AT_OFF = 0, AT_CHANNEL = 1, AT_POLY = 2 };
enum LedMode : uint8_t { LED_LOCAL = 0, LED_HOST = 1, LED_BOTH = 2 };
enum LayerType : uint8_t { LAYER_OFF = 0, LAYER_CUSTOM = 1, LAYER_KEYS = 2 };
enum KeysLayout : uint8_t { KEYS_CHROMATIC = 0, KEYS_IN_KEY = 1 };
enum Thru : uint8_t { THRU_OFF = 0, THRU_CLOCK = 1, THRU_ALL = 2 };

// One control (8 bytes on the wire). Meaning of a..d:
//   pad     a = idle colour, b = pressed colour, c = host colour (palette 0..15)
//   button  type ACTION: number = Action, a = layer (ACT_LAYER)
//   knob    a = min, b = max (min > max: inverted), c = speed (steps per detent, 1..16)
struct Control {
    uint8_t type, channel, number, mode;    // channel 0..15; mode: ButtonMode (pads, buttons) or KnobMode
    uint8_t a, b, c, d;
};

// A pad layer (8 bytes). CUSTOM: the layer's 16 pad controls. KEYS: notes of the scale.
struct Layer {
    uint8_t type;           // LayerType
    uint8_t channel;        // KEYS: MIDI channel 0..15
    uint8_t layout;         // KeysLayout
    uint8_t rowStep;        // KEYS: semitones (CHROMATIC) or scale degrees (IN KEY) from row to row, 1..12
    uint8_t rootColor, scaleColor, outColor, pressedColor;  // palette; outColor: notes outside the scale
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

struct Keys {
    uint8_t root;               // 0..11 (C..B)
    uint8_t scale;              // index in SCALES
    uint8_t octave;             // 0..7, lowest note = 12 * (octave + 1) + root (as JAMbo's keyboard)
    uint8_t followHost;         // 1: SET_SCALE from the app replaces root, scale and octave
};

struct Profile {
    char name[NAME_LEN];
    Sensitivity sens;
    Layer layer[LAYERS];
    Control ctl[CONTROLS];
    uint8_t ledMode;            // LedMode
    uint8_t startLayer;         // the layer after power-up and profile change
    Keys keys;
};

struct Device {
    uint8_t side;               // Side
    uint8_t active;             // active profile 0..3
    uint8_t thru;               // Thru: what from USB goes to the 3.5 mm MIDI OUT
    uint8_t controlsOut;        // 1: the controls' own messages go to MIDI OUT too
    uint8_t ble;                // 1: Bluetooth (BLE-MIDI and the settings service) on
};

// ------------------------------------------------------------------ scales (JAMbo's list)
static const int SCALE_COUNT = 11;
extern const uint16_t SCALE_MASKS[SCALE_COUNT];     // bit k: k semitones above the root is in the scale
int scaleSteps(uint16_t mask, uint8_t steps[12]);   // the mask's semitones, ascending; returns their number

// ------------------------------------------------------------------ byte layout
static const int PROFILE_BYTES = 1559;  // see docs/sysex.md
static const int DEVICE_BYTES = 6;
void serializeProfile(const Profile &p, uint8_t out[PROFILE_BYTES]);
bool deserializeProfile(const uint8_t in[PROFILE_BYTES], Profile &p);   // false: other version
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
uint8_t linearVelocity(const Sensitivity &s, int pad, uint16_t peak);
uint8_t pressureLevel(const Sensitivity &s, int pad, uint16_t raw);

// ------------------------------------------------------------------ KEYS
// The note of a pad (visual position) in a KEYS layer; -1 outside 0..127.
// kind: 0 outside the scale, 1 in the scale, 2 the root.
int keysNote(const Layer &l, int root, uint16_t mask, int octave, int row, int col, int &kind);

// ------------------------------------------------------------------ geometry
// Visual position as the unit sits on the desk (row 0 = top, column 0 = left), with the
// side's rotation. Pads: 4x4; knobs: 4 rows x 2 columns; buttons: a column of 10 (slot 0 = top).
void padPosition(Side side, int pad, int &row, int &col);
int padAt(Side side, int row, int col);
void knobPosition(Side side, int knob, int &row, int &col);
int knobAt(Side side, int row, int col);
int buttonSlot(Side side, int button);
int buttonAt(Side side, int slot);

// ------------------------------------------------------------------ colours
uint32_t paletteRgb(uint8_t index, uint8_t level);    // index 0..15, level 0..127 -> 0xRRGGBB

}  // namespace jp
