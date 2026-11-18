#include "jp_engine.h"
#include <string.h>

namespace jp {

static const int BTN_PAD_BANK = 1, BTN_KNOB_BANK = 2;      // held together: the profile menu
static const uint32_t MONITOR_MS = 33;

static int clampInt(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

// ------------------------------------------------------------------ setup and storage

void Engine::begin(uint32_t nowMs) {
    (void)nowMs;
    for (int p = 0; p < PADS; p++) pressCtl[p] = PRESS_NONE;
    loadAll();
    applyActive();
    updateLeds();
}

void Engine::loadAll() {
    static uint8_t buf[PROFILE_BYTES];
    if (hal.storeRead(STORE_DEVICE, buf, DEVICE_BYTES) != DEVICE_BYTES || !deserializeDevice(buf, dev)) {
        defaultDevice(dev);
    }
    for (int i = 0; i < PROFILES; i++) {
        if (hal.storeRead(STORE_DEVICE + 1 + i, buf, PROFILE_BYTES) != PROFILE_BYTES ||
            !deserializeProfile(buf, prof[i])) {
            defaultProfile(prof[i], (Side)dev.side);
        }
        profileDirty[i] = false;
    }
}

bool Engine::saveDevice() {
    uint8_t buf[DEVICE_BYTES];
    serializeDevice(dev, buf);
    return hal.storeWrite(STORE_DEVICE, buf, DEVICE_BYTES) == DEVICE_BYTES;
}

bool Engine::saveProfile(int i) {
    static uint8_t buf[PROFILE_BYTES];
    serializeProfile(prof[i], buf);
    bool ok = hal.storeWrite(STORE_DEVICE + 1 + i, buf, PROFILE_BYTES) == PROFILE_BYTES;
    if (ok) profileDirty[i] = false;
    return ok;
}

void Engine::applyActive() {
    const Profile &p = prof[dev.active];
    buildVelocityLut(p.sens, lut);
    memset(toggled, 0, sizeof toggled);
    memset(hostVal, 0, sizeof hostVal);
    memset(hostSeen, 0, sizeof hostSeen);
    curLayer = p.startLayer;
    resetKnobs();
    applyKeys();
    ledDirty = true;
}

void Engine::applyKeys() {
    const Profile &p = prof[dev.active];
    if (p.keys.followHost && hostScale) {
        keyRoot = hostRoot; keyMask = hostMask; keyOctave = hostOctave;
    } else {
        keyRoot = p.keys.root; keyMask = SCALE_MASKS[p.keys.scale]; keyOctave = p.keys.octave;
    }
    ledDirty = true;
}

void Engine::resetKnobs() {
    const Profile &p = prof[dev.active];
    for (int k = 0; k < KNOBS; k++) {
        const Control &x = p.ctl[CTL_KNOB0 + k];
        knobVal[k] = x.a < x.b ? x.a : x.b;
    }
}

void Engine::setLayer(int L) {
    if (L < 0 || L >= LAYERS || prof[dev.active].layer[L].type == LAYER_OFF || L == curLayer) return;
    curLayer = L;
    ledDirty = true;
    uint8_t ev[1] = {(uint8_t)L};
    sendSysex(EV_LAYER, ev, 1);
}

// ------------------------------------------------------------------ pads

void Engine::padSample(int pad, uint16_t raw, uint32_t nowMs) {
    if (pad < 0 || pad >= PADS) return;
    padRaw[pad] = raw;
    const Sensitivity &s = prof[dev.active].sens;
    switch (padState[pad]) {
        case PAD_IDLE:
            if (raw > s.onThreshold) {
                padState[pad] = PAD_ATTACK;
                padT0[pad] = nowMs;
                padPeak[pad] = raw;
            }
            break;
        case PAD_ATTACK:
            if (raw > padPeak[pad]) padPeak[pad] = raw;
            if (nowMs - padT0[pad] >= s.attackMs || raw < s.offThreshold) {
                uint8_t lin = linearVelocity(s, pad, padPeak[pad]);
                uint8_t vel = lut[lin];
                padState[pad] = PAD_HELD;
                if (monitor) {
                    uint8_t ev[5] = {(uint8_t)pad, (uint8_t)(padPeak[pad] & 0x7F), (uint8_t)(padPeak[pad] >> 7), lin, vel};
                    sendSysex(EV_HIT, ev, 5);
                }
                padOn(pad, vel);
                if (raw < s.offThreshold) {
                    padState[pad] = PAD_IDLE;
                    padOff(pad);
                }
            }
            break;
        case PAD_HELD: {
            if (raw < s.offThreshold) {
                padState[pad] = PAD_IDLE;
                padOff(pad);
                break;
            }
            // aftertouch: only for notes
            bool isNote = pressCtl[pad] == PRESS_KEYS ||
                          (pressCtl[pad] >= 0 && prof[dev.active].ctl[pressCtl[pad]].type == MSG_NOTE);
            if (s.atMode == AT_OFF || !isNote) break;
            uint8_t lvl = pressureLevel(s, pad, raw);
            if (lvl == atLast[pad] || nowMs - atAt[pad] < s.atIntervalMs) break;
            atLast[pad] = lvl;
            atAt[pad] = nowMs;
            if (s.atMode == AT_POLY) send(0xA0 | sentCh[pad], sentNote[pad], lvl, 3);
            else sendChannelAt(sentCh[pad]);
            break;
        }
    }
}

void Engine::sendChannelAt(uint8_t ch) {
    uint8_t mx = 0;
    for (int p = 0; p < PADS; p++) if (padState[p] == PAD_HELD && pressCtl[p] != PRESS_NONE && atLast[p] > mx) mx = atLast[p];
    if (mx != channelAt) {
        channelAt = mx;
        send(0xD0 | ch, mx, 0, 2);
    }
}

void Engine::padOn(int pad, uint8_t vel) {
    ledDirty = true;
    pressCtl[pad] = PRESS_NONE;
    atLast[pad] = 0;
    if (identify) {
        uint8_t ev[3] = {0, (uint8_t)pad, vel};
        sendSysex(EV_IDENTIFY, ev, 3);
        return;
    }
    if (menu) {
        menuPad[pad] = true;
        int slot = menuSlot(pad);
        if (slot >= 0 && slot != dev.active) {
            dev.active = (uint8_t)slot;
            applyActive();
            saveDevice();
            uint8_t ev[1] = {(uint8_t)slot};
            sendSysex(EV_PROFILE, ev, 1);
        }
        return;
    }
    const Profile &p = prof[dev.active];
    const Layer &l = p.layer[curLayer];
    if (l.type == LAYER_KEYS) {
        int row, col, kind;
        padPosition((Side)dev.side, pad, row, col);
        int note = keysNote(l, keyRoot, keyMask, keyOctave, row, col, kind);
        if (note < 0) return;
        pressCtl[pad] = PRESS_KEYS;
        sentCh[pad] = l.channel;
        sentNote[pad] = (uint8_t)note;
        send(0x90 | l.channel, (uint8_t)note, vel, 3);
        return;
    }
    int ctl = curLayer * PADS + pad;
    const Control &x = p.ctl[ctl];
    if (x.type == MSG_OFF) return;
    pressCtl[pad] = (int16_t)ctl;
    sentCh[pad] = x.channel;
    sentNote[pad] = x.number;
    controlPress(ctl, vel);
}

void Engine::padOff(int pad) {
    ledDirty = true;
    if (identify) {
        uint8_t ev[3] = {0, (uint8_t)pad, 0};
        sendSysex(EV_IDENTIFY, ev, 3);
        return;
    }
    if (menuPad[pad]) {
        menuPad[pad] = false;
        return;
    }
    int16_t was = pressCtl[pad];
    if (was == PRESS_NONE) return;
    const Sensitivity &s = prof[dev.active].sens;
    if (s.atMode == AT_POLY && atLast[pad] > 0) send(0xA0 | sentCh[pad], sentNote[pad], 0, 3);
    atLast[pad] = 0;
    pressCtl[pad] = PRESS_NONE;
    if (s.atMode == AT_CHANNEL) sendChannelAt(sentCh[pad]);
    if (was == PRESS_KEYS) send(0x80 | sentCh[pad], sentNote[pad], 0, 3);
    else controlRelease(was);
}

// ------------------------------------------------------------------ buttons and knobs

void Engine::buttonEvent(int button, bool down, uint32_t nowMs) {
    (void)nowMs;
    if (button < 0 || button >= BUTTONS) return;
    btnDown[button] = down;
    ledDirty = true;
    checkMenu();
    if (identify) {
        uint8_t ev[3] = {1, (uint8_t)button, (uint8_t)(down ? 127 : 0)};
        sendSysex(EV_IDENTIFY, ev, 3);
        return;
    }
    const Control &x = prof[dev.active].ctl[CTL_BUTTON0 + button];
    if (x.type == MSG_ACTION) {
        if (down) buttonAction(x);
        return;
    }
    if (down) controlPress(CTL_BUTTON0 + button, 127);
    else controlRelease(CTL_BUTTON0 + button);
}

void Engine::buttonAction(const Control &x) {
    switch (x.number) {
        case ACT_LAYER: setLayer(x.a); break;
        case ACT_OCT_UP: if (keyOctave < 7) { keyOctave++; ledDirty = true; } break;
        case ACT_OCT_DOWN: if (keyOctave > 0) { keyOctave--; ledDirty = true; } break;
        default: break;
    }
}

void Engine::checkMenu() {
    bool open = btnDown[BTN_PAD_BANK] && btnDown[BTN_KNOB_BANK];
    if (open != menu) {
        menu = open;
        ledDirty = true;
    }
}

int Engine::menuSlot(int pad) const {
    int row, col;
    padPosition((Side)dev.side, pad, row, col);
    return row == 0 ? col : -1;
}

void Engine::knobEvent(int knob, int delta) {
    if (knob < 0 || knob >= KNOBS || delta == 0) return;
    if (identify) {
        uint8_t ev[3] = {2, (uint8_t)knob, (uint8_t)clampInt(64 + delta, 0, 127)};
        sendSysex(EV_IDENTIFY, ev, 3);
        return;
    }
    const Control &x = prof[dev.active].ctl[CTL_KNOB0 + knob];
    if (x.type == MSG_OFF) return;
    int d = delta * x.c;
    if (x.mode == KNOB_ABS) {
        int lo = x.a < x.b ? x.a : x.b, hi = x.a < x.b ? x.b : x.a;
        if (x.a > x.b) d = -d;
        int v = clampInt(knobVal[knob] + d, lo, hi);
        if (v == knobVal[knob]) return;
        knobVal[knob] = (uint8_t)v;
        send(0xB0 | x.channel, x.number, (uint8_t)v, 3);
        return;
    }
    if (x.a > x.b) d = -d;
    d = clampInt(d, -63, 63);
    uint8_t v;
    if (x.mode == KNOB_REL64) v = (uint8_t)(64 + d);
    else if (x.mode == KNOB_REL2C) v = (uint8_t)(d < 0 ? 128 + d : d);
    else v = (uint8_t)(d < 0 ? 64 - d : d);         // signed bit: 1 up, 65 down
    send(0xB0 | x.channel, x.number, v, 3);
}

// ------------------------------------------------------------------ MIDI out

void Engine::controlPress(int ctl, uint8_t value) {
    const Control &x = prof[dev.active].ctl[ctl];
    if (x.type == MSG_OFF || x.type == MSG_ACTION) return;
    if (x.mode == MODE_TOGGLE) {
        toggled[ctl] = !toggled[ctl];
        sendMessage(ctl, toggled[ctl], value);
    } else {
        sendMessage(ctl, true, value);
    }
}

void Engine::controlRelease(int ctl) {
    const Control &x = prof[dev.active].ctl[ctl];
    if (x.type == MSG_OFF || x.type == MSG_ACTION || x.mode == MODE_TOGGLE) return;
    sendMessage(ctl, false, 0);
}

void Engine::sendMessage(int ctl, bool on, uint8_t value) {
    const Control &x = prof[dev.active].ctl[ctl];
    switch (x.type) {
        case MSG_NOTE:
            if (on) send(0x90 | x.channel, x.number, value ? value : 1, 3);
            else send(0x80 | x.channel, x.number, 0, 3);
            break;
        case MSG_CC:
            send(0xB0 | x.channel, x.number, on ? (value ? value : 1) : 0, 3);
            break;
        case MSG_PC:
            if (on) send(0xC0 | x.channel, x.number, 0, 2);
            break;
        default:
            break;
    }
}

void Engine::send(uint8_t status, uint8_t d1, uint8_t d2, int len) {
    uint8_t m[3] = {status, (uint8_t)(d1 & 0x7F), (uint8_t)(d2 & 0x7F)};
    hal.midiOut(m, len);
    if (dev.controlsOut) hal.dinOut(m, len);
}

void Engine::sendSysex(uint8_t cmd, const uint8_t *payload, int len) {
    static uint8_t buf[SYSEX_MAX];
    if (len + 6 > SYSEX_MAX) return;
    memcpy(buf, SYSEX_ID, 4);
    buf[4] = cmd;
    for (int i = 0; i < len; i++) buf[5 + i] = payload[i] & 0x7F;
    buf[5 + len] = 0xF7;
    hal.midiOut(buf, len + 6);
}

void Engine::reply(uint8_t cmd, uint8_t status) {
    sendSysex(cmd | REPLY, &status, 1);
}

// ------------------------------------------------------------------ MIDI in (USB)

void Engine::midiIn(uint8_t b) {
    if (b >= 0xF8) {                                // real time: clock and transport to MIDI OUT
        bool clock = b == 0xF8 || b == 0xFA || b == 0xFB || b == 0xFC;
        if ((dev.thru == THRU_CLOCK && clock) || (dev.thru == THRU_ALL && b != 0xFE)) hal.dinOut(&b, 1);
        return;
    }
    if (b == 0xF0) {
        sysexLen = 0;
        sysex[sysexLen++] = b;
        runStatus = 0;
        return;
    }
    if (b == 0xF7) {
        if (sysexLen > 0 && sysexLen < SYSEX_MAX) {
            sysex[sysexLen++] = b;
            if (sysexLen >= 5 && memcmp(sysex, SYSEX_ID, 4) == 0) handleSysex(sysex, sysexLen);
            else if (dev.thru == THRU_ALL) hal.dinOut(sysex, sysexLen);
        }
        sysexLen = -1;
        return;
    }
    if (b & 0x80) {
        sysexLen = -1;
        runStatus = b < 0xF0 ? b : 0;
        dataCount = 0;
        return;
    }
    if (sysexLen >= 0) {
        if (sysexLen < SYSEX_MAX - 1) sysex[sysexLen++] = b;
        else sysexLen = SYSEX_MAX;                  // too long: dropped at F7
        return;
    }
    if (!runStatus) return;
    data[dataCount++] = b;
    uint8_t type = runStatus & 0xF0;
    int need = (type == 0xC0 || type == 0xD0) ? 1 : 2;
    if (dataCount >= need) {
        if (dev.thru == THRU_ALL) {
            uint8_t m[3] = {runStatus, data[0], data[1]};
            hal.dinOut(m, need + 1);
        }
        handleShort(runStatus, data[0], need == 2 ? data[1] : 0);
        dataCount = 0;
    }
}

void Engine::handleShort(uint8_t status, uint8_t d1, uint8_t d2) {
    uint8_t type = status & 0xF0, ch = status & 0x0F;
    uint8_t msgType;
    uint8_t value = d2;
    if (type == 0x90) msgType = MSG_NOTE;
    else if (type == 0x80) { msgType = MSG_NOTE; value = 0; }
    else if (type == 0xB0) msgType = MSG_CC;
    else return;
    const Profile &p = prof[dev.active];
    for (int c = 0; c < CTL_KNOB0; c++) {
        if (c < CTL_BUTTON0 && p.layer[c / PADS].type != LAYER_CUSTOM) continue;
        const Control &x = p.ctl[c];
        if (x.type == msgType && x.channel == ch && x.number == d1) {
            hostVal[c] = value;
            hostSeen[c] = true;
            ledDirty = true;
        }
    }
    if (msgType != MSG_CC) return;
    for (int k = 0; k < KNOBS; k++) {
        const Control &x = p.ctl[CTL_KNOB0 + k];
        if (x.type == MSG_CC && x.mode == KNOB_ABS && x.channel == ch && x.number == d1) {
            int lo = x.a < x.b ? x.a : x.b, hi = x.a < x.b ? x.b : x.a;
            knobVal[k] = (uint8_t)clampInt(value, lo, hi);
        }
    }
}

void Engine::handleSysex(const uint8_t *m, int len) {
    if (len < 6 || memcmp(m, SYSEX_ID, 4) != 0) return;
    uint8_t cmd = m[4];
    const uint8_t *pl = m + 5;
    int n = len - 6;
    switch (cmd) {
        case CMD_HELLO: {
            uint8_t r[11] = {ST_OK, FW_MAJOR, FW_MINOR, FW_PATCH, FORMAT_VERSION, dev.side, dev.active, PROFILES,
                             dev.thru, dev.controlsOut, (uint8_t)curLayer};
            sendSysex(CMD_HELLO | REPLY, r, 11);
            break;
        }
        case CMD_GET_PROFILE: {
            if (n < 1 || pl[0] >= PROFILES) { reply(cmd, ST_BAD_ARGS); break; }
            static uint8_t raw[PROFILE_BYTES];
            static uint8_t r[2 + PROFILE_BYTES + PROFILE_BYTES / 7 + 2];
            serializeProfile(prof[pl[0]], raw);
            r[0] = ST_OK;
            r[1] = pl[0];
            size_t k = pack7(raw, PROFILE_BYTES, r + 2);
            sendSysex(CMD_GET_PROFILE | REPLY, r, (int)k + 2);
            break;
        }
        case CMD_SET_PROFILE: {
            if (n < 1 || pl[0] >= PROFILES || (size_t)(n - 1) != packedSize(PROFILE_BYTES)) { reply(cmd, ST_BAD_ARGS); break; }
            static uint8_t raw[PROFILE_BYTES + 8];
            static Profile t;
            if (unpack7(pl + 1, n - 1, raw) != PROFILE_BYTES || !deserializeProfile(raw, t)) { reply(cmd, ST_BAD_ARGS); break; }
            int i = pl[0];
            prof[i] = t;
            profileDirty[i] = true;
            if (i == dev.active) {
                // keep the layer while editing if it still exists
                int keep = curLayer;
                applyActive();
                if (prof[i].layer[keep].type != LAYER_OFF) curLayer = keep;
            }
            uint8_t r[2] = {ST_OK, (uint8_t)i};
            sendSysex(cmd | REPLY, r, 2);
            break;
        }
        case CMD_SAVE: {
            bool ok = saveDevice();
            for (int i = 0; i < PROFILES; i++) if (profileDirty[i]) ok = saveProfile(i) && ok;
            reply(cmd, ok ? ST_OK : ST_STORE_ERROR);
            break;
        }
        case CMD_SELECT: {
            if (n < 1 || pl[0] >= PROFILES) { reply(cmd, ST_BAD_ARGS); break; }
            dev.active = pl[0];
            applyActive();
            bool ok = saveDevice();
            uint8_t r[2] = {(uint8_t)(ok ? ST_OK : ST_STORE_ERROR), dev.active};
            sendSysex(cmd | REPLY, r, 2);
            break;
        }
        case CMD_SET_SIDE: {
            if (n < 1 || pl[0] > SIDE_LEFT) { reply(cmd, ST_BAD_ARGS); break; }
            dev.side = pl[0];
            ledDirty = true;
            bool ok = saveDevice();
            uint8_t r[2] = {(uint8_t)(ok ? ST_OK : ST_STORE_ERROR), dev.side};
            sendSysex(cmd | REPLY, r, 2);
            break;
        }
        case CMD_MONITOR:
            if (n < 1) { reply(cmd, ST_BAD_ARGS); break; }
            monitor = pl[0] != 0;
            reply(cmd, ST_OK);
            break;
        case CMD_SET_RGB:
            if (n < 4) break;
            if (pl[0] == 127) {
                memset(rgbOverrideOn, 0, sizeof rgbOverrideOn);
            } else if (pl[0] < PADS) {
                rgbOverride[pl[0]] = (uint32_t)(pl[1] << 1 | pl[1] >> 6) << 16 | (uint32_t)(pl[2] << 1 | pl[2] >> 6) << 8 |
                                     (uint32_t)(pl[3] << 1 | pl[3] >> 6);
                rgbOverrideOn[pl[0]] = true;
            }
            ledDirty = true;
            break;
        case CMD_BOOTLOADER:
            reply(cmd, ST_OK);
            hal.enterBootloader();
            break;
        case CMD_FACTORY_RESET: {
            bool ok = true;
            for (int i = 0; i < PROFILES; i++) {
                defaultProfile(prof[i], (Side)dev.side);
                ok = saveProfile(i) && ok;
            }
            dev.active = 0;
            ok = saveDevice() && ok;
            applyActive();
            reply(cmd, ok ? ST_OK : ST_STORE_ERROR);
            break;
        }
        case CMD_IDENTIFY:
            if (n < 1) { reply(cmd, ST_BAD_ARGS); break; }
            identify = pl[0] != 0;
            reply(cmd, ST_OK);
            break;
        case CMD_SET_SCALE:
            // from the app, no reply (it may be sent to every port): root, mask bits 0-6, bits 7-11, octave (127 = keep)
            if (n < 3) break;
            hostScale = true;
            hostRoot = pl[0] % 12;
            hostMask = (uint16_t)((pl[1] & 0x7F) | (pl[2] & 0x1F) << 7);
            if (n >= 4 && pl[3] <= 7) hostOctave = pl[3];
            if (prof[dev.active].keys.followHost) applyKeys();
            break;
        case CMD_SET_MIDI_OUT: {
            if (n < 2 || pl[0] > THRU_ALL) { reply(cmd, ST_BAD_ARGS); break; }
            dev.thru = pl[0];
            dev.controlsOut = pl[1] ? 1 : 0;
            reply(cmd, saveDevice() ? ST_OK : ST_STORE_ERROR);
            break;
        }
        case CMD_SET_LAYER: {
            if (n < 1 || pl[0] >= LAYERS || prof[dev.active].layer[pl[0]].type == LAYER_OFF) { reply(cmd, ST_BAD_ARGS); break; }
            setLayer(pl[0]);
            reply(cmd, ST_OK);
            break;
        }
        default:
            break;
    }
}

// ------------------------------------------------------------------ lights and time

void Engine::tick(uint32_t nowMs) {
    if (monitor && nowMs - monitorAt >= MONITOR_MS) {
        monitorAt = nowMs;
        uint8_t ev[PADS * 2];
        for (int p = 0; p < PADS; p++) {
            ev[p * 2] = padRaw[p] & 0x7F;
            ev[p * 2 + 1] = (uint8_t)(padRaw[p] >> 7);
        }
        sendSysex(EV_PRESSURE, ev, PADS * 2);
    }
    if (ledDirty) updateLeds();
}

uint32_t Engine::padColor(int pad) {
    const Profile &p = prof[dev.active];
    bool pressed = padState[pad] != PAD_IDLE && !menuPad[pad];
    if (menu) {
        int slot = menuSlot(pad);
        return slot < 0 ? 0 : paletteRgb(slot == dev.active ? 1 : 11, slot == dev.active ? 127 : 24);
    }
    const Layer &l = p.layer[curLayer];
    if (l.type == LAYER_KEYS) {
        int row, col, kind;
        padPosition((Side)dev.side, pad, row, col);
        int note = keysNote(l, keyRoot, keyMask, keyOctave, row, col, kind);
        if (note < 0) return 0;
        if (pressed) return paletteRgb(l.pressedColor, 127);
        if (kind == 2) return paletteRgb(l.rootColor, 127);
        if (kind == 1) return paletteRgb(l.scaleColor, 40);
        return paletteRgb(l.outColor, 12);
    }
    int ctl = curLayer * PADS + pad;
    const Control &x = p.ctl[ctl];
    if (p.ledMode == LED_HOST) return rgbOverrideOn[pad] ? rgbOverride[pad] : paletteRgb(x.c, hostVal[ctl]);
    if (pressed) return paletteRgb(x.b, 127);
    if (rgbOverrideOn[pad] && p.ledMode == LED_BOTH) return rgbOverride[pad];
    if (hostVal[ctl] > 0 && p.ledMode == LED_BOTH) return paletteRgb(x.c, hostVal[ctl]);
    if (toggled[ctl] && (p.ledMode == LED_LOCAL || !hostSeen[ctl])) return paletteRgb(x.b, 64);
    return paletteRgb(x.a, 32);
}

void Engine::updateLeds() {
    ledDirty = false;
    const Profile &p = prof[dev.active];
    for (int pad = 0; pad < PADS; pad++) hal.padRgb(pad, padColor(pad));
    hal.padShow();
    for (int b = 0; b < BUTTONS; b++) {
        int ctl = CTL_BUTTON0 + b;
        const Control &x = p.ctl[ctl];
        bool on;
        if (x.type == MSG_ACTION) on = x.number == ACT_LAYER ? x.a == curLayer : btnDown[b];
        else if (p.ledMode == LED_HOST) on = hostVal[ctl] > 0;
        else if (p.ledMode == LED_LOCAL) on = btnDown[b] || toggled[ctl];
        else on = btnDown[b] || hostVal[ctl] > 0 || (toggled[ctl] && !hostSeen[ctl]);
        hal.buttonLed(b, on);
    }
}

}  // namespace jp
