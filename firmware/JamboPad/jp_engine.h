// JamboPad engine: everything the firmware does, without the hardware. The sketch feeds it the
// pads' raw pressure, buttons, knobs and incoming MIDI bytes and gives it a Hal for the rest.
#pragma once
#include "jp_config.h"

namespace jp {

class Hal {
public:
    virtual ~Hal() {}
    virtual void midiOut(const uint8_t *msg, int len) = 0;      // USB: one complete MIDI message
    virtual void dinOut(const uint8_t *msg, int len) = 0;       // 3.5 mm MIDI OUT: raw bytes
    virtual void padRgb(int pad, uint32_t rgb) = 0;             // shown by padShow()
    virtual void padShow() = 0;
    virtual void buttonLed(int button, bool on) = 0;
    virtual int storeRead(int key, void *buf, int len) = 0;     // bytes read, <= 0: none
    virtual int storeWrite(int key, const void *buf, int len) = 0;
    virtual void enterBootloader() = 0;                         // does not return on the device
    virtual void setBluetooth(bool on) = 0;                     // advertise or not (drops a connection)
};

// SysEx: F0 7D 4A 50 <command> <data...> F7 (docs/sysex.md)
static const uint8_t SYSEX_ID[4] = {0xF0, 0x7D, 0x4A, 0x50};
enum Command : uint8_t {
    CMD_HELLO = 0x01, CMD_GET_PROFILE = 0x02, CMD_SET_PROFILE = 0x03, CMD_SAVE = 0x04,
    CMD_SELECT = 0x05, CMD_SET_SIDE = 0x06, CMD_MONITOR = 0x07, CMD_SET_RGB = 0x08,
    CMD_BOOTLOADER = 0x09, CMD_FACTORY_RESET = 0x0A, CMD_IDENTIFY = 0x0B,
    CMD_SET_SCALE = 0x0C, CMD_SET_MIDI_OUT = 0x0D, CMD_SET_LAYER = 0x0E, CMD_SET_BLUETOOTH = 0x0F,
    REPLY = 0x40,                   // a reply is the command | 0x40
    EV_PRESSURE = 0x60, EV_HIT = 0x61, EV_IDENTIFY = 0x62, EV_PROFILE = 0x63, EV_LAYER = 0x64, EV_ROOT = 0x65, EV_BLUETOOTH = 0x66, EV_SCALE = 0x67,
};
enum Status : uint8_t { ST_OK = 0, ST_BAD_ARGS = 1, ST_STORE_ERROR = 2 };

static const int STORE_DEVICE = 30;     // + profile index + 1 for the profiles (format 2)
static const int SYSEX_MAX = 2048;

class Engine {
public:
    explicit Engine(Hal &hal) : hal(hal) {}

    void begin(uint32_t nowMs);
    void padSample(int pad, uint16_t raw, uint32_t nowMs);      // each new ADC pass
    void buttonEvent(int button, bool down, uint32_t nowMs);
    void knobEvent(int knob, int delta);
    // inputs, each with its own parser: USB, BLE-MIDI, the Bluetooth settings service
    enum Port : uint8_t { PORT_USB = 0, PORT_BLE_MIDI = 1, PORT_BLE_CFG = 2, PORTS = 3 };
    void midiIn(uint8_t byte, Port port = PORT_USB);
    void tick(uint32_t nowMs);                                  // every loop()

    // for the tests and the sketch
    const Device &device() const { return dev; }
    const Profile &profile(int i) const { return prof[i]; }
    const Profile &activeProfile() const { return prof[dev.active]; }
    uint8_t knobValue(int k) const { return knobVal[k]; }
    bool menuOpen() const { return menu; }
    bool pickingRoot() const { return rootPick >= 0; }
    bool pickingScale() const { return scalePick >= 0; }
    int layer() const { return curLayer; }
    int octave() const { return keyOctave; }
    int root() const { return keyRoot; }
    uint16_t scaleMask() const { return keyMask; }

private:
    enum PadState : uint8_t { PAD_IDLE, PAD_ATTACK, PAD_HELD };
    static const int16_t PRESS_NONE = -1, PRESS_KEYS = -2;

    Hal &hal;
    Device dev;
    Profile prof[PROFILES];
    uint8_t lut[128];

    // runtime keys state: from the profile, or from the app (SET_SCALE) when the profile follows it
    int curLayer = 0;
    uint8_t keyRoot = 0, keyOctave = 3;
    uint16_t keyMask = 0xAB5;
    bool hostScale = false;
    uint8_t hostRoot = 0, hostOctave = 3;
    uint16_t hostMask = 0xAB5;

    PadState padState[PADS] = {};
    uint32_t padT0[PADS] = {};
    uint16_t padPeak[PADS] = {};
    uint16_t padRaw[PADS] = {};
    int16_t pressCtl[PADS] = {};    // what the press sent: a control, PRESS_KEYS or PRESS_NONE
    uint8_t sentCh[PADS] = {}, sentNote[PADS] = {};
    uint8_t atLast[PADS] = {};
    uint32_t atAt[PADS] = {};
    uint8_t channelAt = 0;
    bool menuPad[PADS] = {};        // pressed while the profile menu was open: no MIDI

    bool btnDown[BUTTONS] = {};
    bool toggled[CONTROLS] = {};
    uint8_t hostVal[CONTROLS] = {};
    bool hostSeen[CONTROLS] = {};
    uint8_t knobVal[KNOBS] = {};
    uint32_t rgbOverride[PADS] = {};
    bool rgbOverrideOn[PADS] = {};

    bool menu = false;
    int rootPick = -1;             // the button held with ACTION ROOT, -1: none
    int scalePick = -1;            // the button held with ACTION SCALE, -1: none
    bool monitor = false;
    bool identify = false;
    uint32_t monitorAt = 0;
    bool ledDirty = true;
    bool profileDirty[PROFILES] = {};

    // MIDI input parsers, one per port
    struct Parser {
        uint8_t runStatus = 0, data[2] = {}, dataCount = 0;
        uint8_t sysex[SYSEX_MAX];
        int sysexLen = -1;          // -1: not in a SysEx
    };
    Parser parser[PORTS];

    void applyActive();
    void applyKeys();
    void resetKnobs();
    void loadAll();
    bool saveDevice();
    bool saveProfile(int i);
    void setLayer(int L);
    void selectProfile(int i);
    void setBluetooth(bool on);

    void padOn(int pad, uint8_t vel);
    void padOff(int pad);
    void controlPress(int ctl, uint8_t value);
    void controlRelease(int ctl);
    void buttonAction(const Control &x);
    void send(uint8_t status, uint8_t d1, uint8_t d2, int len);
    void sendMessage(int ctl, bool on, uint8_t value);
    void sendSysex(uint8_t cmd, const uint8_t *payload, int len);
    void reply(uint8_t cmd, uint8_t status);
    void sendChannelAt(uint8_t ch);

    void handleShort(uint8_t status, uint8_t d1, uint8_t d2);
    void handleSysex(const uint8_t *msg, int len);
    void updateLeds();
    uint32_t padColor(int pad);
    void checkMenu();
    int menuSlot(int pad) const;    // 0..3 when the pad is in the top row, else -1
    int rootSlot(int pad) const;    // 0..11 (C..B) for the three lower rows, else -1
};

}  // namespace jp
