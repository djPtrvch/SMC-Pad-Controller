# JAMboPAD SysEx protocol (format version 3)

Every message: `F0 7D 4A 50 <cmd> <data…> F7` (0x7D — non-commercial ID, `4A 50` — "JP"). All data bytes are 7-bit.
A reply is the command `| 0x40`, its first data byte is the status: 0 OK, 1 bad arguments, 2 storage error.
Implementations: firmware/JamboPad/jp_engine.cpp, web/src/protocol.ts.

## Commands (host → device)

| cmd | name | data | reply data |
|---|---|---|---|
| 01 | HELLO | — | status, fw major, minor, patch, format version, side, active profile, profile count, MIDI OUT thru, controls to MIDI OUT, layer, Bluetooth on |
| 02 | GET_PROFILE | p | status, p, profile (packed, 1782 bytes) |
| 03 | SET_PROFILE | p, profile (packed) | status, p — applied at once if p is active; kept in RAM until SAVE |
| 04 | SAVE | — | status — writes the device settings and changed profiles to flash |
| 05 | SELECT | p | status, p — saved at once |
| 06 | SET_SIDE | 0 RIGHT, 1 LEFT | status, side — saved at once; profiles stay (FACTORY_RESET rebuilds them for the side) |
| 07 | MONITOR | 0/1 | status — events 60 and 61 while on |
| 08 | SET_RGB | pad, r, g, b (0..127) | none — the pad shows this colour (LED modes HOST, BOTH); pad 127 clears all |
| 09 | BOOTLOADER | — | status, then the device restarts into DFU (USB 1209:0002) |
| 0A | FACTORY_RESET | — | status — 4 default profiles for the side, profile 1 active |
| 0B | IDENTIFY | 0/1 | status — while on, controls send event 62 instead of MIDI |
| 0C | SET_SCALE | root 0–11, mask bits 0–6, mask bits 7–11, octave 0–7 (127 keep) | none — from the app; used by KEYS layers when the profile follows the app |
| 0D | SET_MIDI_OUT | thru (0 OFF, 1 CLOCK, 2 ALL), controls 0/1 | status — saved at once |
| 0E | SET_LAYER | bank 0–9 | status — the pads show this layer (not OFF layers) |
| 0F | SET_BLUETOOTH | 0/1 | status (sent before switching: off drops a Bluetooth connection) — saved |
| 11 | DIN_OUT | MIDI bytes, packed (see Packing) | none — firmware 0.7.0 and later; see MIDI OUT |

## Events (device → host)

| cmd | name | data |
|---|---|---|
| 60 | PRESSURE | 16 × (low 7 bits, high 3 bits) raw pressure 0..1023, physical pad order, every 33 ms |
| 61 | HIT | pad, peak low 7, peak high 3, linear velocity, output velocity |
| 62 | IDENTIFY | kind (0 pad, 1 button, 2 knob), physical index, value (velocity / 127 down, 0 up / 64 + delta) |
| 63 | PROFILE | p — selected on the device (PAD BANK + KNOB BANK held, then a pad of the top row) |
| 64 | LAYER | layer — changed on the device (a button with ACTION → LAYER) |
| 66 | BLUETOOTH | 0/1 — switched on the device (ACTION BLUETOOTH) or by SET_BLUETOOTH |
| 67 | SCALE | scale index 0–10, mask bits 0–6, mask bits 7–11 — picked on the device (a button with ACTION → SCALE held, then a pad) |
| 65 | ROOT | key note 0–11 — picked on the device (a button with ACTION → KEY NOTE held, then a pad) |

## Packing

8-bit data is sent as groups of up to 7 bytes: first a byte with the high bits (bit k = byte k's bit 7), then the 7 bytes' low 7 bits. 1559 bytes → 1782.

## Profile (1559 bytes)

| offset | size | field |
|---|---|---|
| 0 | 1 | format version (3) |
| 1 | 12 | name, ASCII, 0-padded |
| 13 | 2 | on threshold (LE, raw 0..1023, 150) |
| 15 | 2 | off threshold (80) |
| 17 | 2 | full scale — raw peak for velocity 127 (960) |
| 19 | 1 | attack window, ms (9) |
| 20 | 1 | curve: 0 LINEAR, 1 SOFT, 2 HARD, 3 EXP, 4 LOG, 5 S-CURVE, 6 FIXED, 7 CUSTOM |
| 21 | 1 | velocity min (1) |
| 22 | 1 | velocity max (127) |
| 23 | 1 | fixed velocity (100) |
| 24 | 5 | custom curve: output at input 0, 25, 50, 75, 100 % |
| 29 | 1 | aftertouch: 0 OFF, 1 CHANNEL, 2 POLY |
| 30 | 2 | aftertouch threshold (raw, 300) |
| 32 | 1 | aftertouch interval, ms (10) |
| 33 | 16 | pad gain, % 50..200 (100), physical pad order |
| 49 | 10 × 8 | pad banks ("layers"): type (0 OFF, 1 CUSTOM, 2 KEYS), channel, layout (0 CHROMATIC, 1 IN KEY), row step, root colour, scale colour, out-of-scale colour, pressed colour |
| 129 | 178 × 8 | controls: bank L's pads at L·16 + pad (physical), buttons 160–169, knobs 170–177 |
| 1553 | 1 | LED mode: 0 LOCAL, 1 HOST, 2 BOTH |
| 1554 | 1 | start bank |
| 1555 | 4 | KEYS: root 0–11, scale (index, list below), octave 0–7, follow the app 0/1 |

Control (8 bytes): type (0 OFF, 1 NOTE, 2 CC, 3 PC, 4 ACTION — buttons only; knobs — OFF or CC), channel 0–15, number, mode, a, b, c, d.
- pad: mode 0 MOMENTARY / 1 TOGGLE; a idle colour, b pressed colour, c host colour (palette 0–15).
- button: mode 0 MOMENTARY / 1 TOGGLE; ACTION: number 0 PAD BANK (a = bank 0–9), 1 OCTAVE UP, 2 OCTAVE DOWN (KEYS), 4 BLUETOOTH (on / off; lit while on), 5 PROFILE (a = profile 0–3, all the settings), 6 SCALE (held: the 11 lowest pads, from the bottom-left as the unit sits, are the scales in the list order below; a tap picks one, event 67), 3 KEY NOTE (held: the three lower rows of pads are C … B as the unit sits, from the bottom-left; a tap picks the key note, event 65).
- knob: mode 0 ABSOLUTE, 1 RELATIVE OFFSET 64, 2 RELATIVE 2'S COMPLEMENT, 3 RELATIVE SIGNED BIT; a min, b max (a > b — inverted), c speed (steps per detent, 1–16).

Palette: 0 off, 1 white, 2 red, 3 orange-red, 4 orange, 5 yellow, 6 lime, 7 green, 8 mint, 9 cyan, 10 sky, 11 blue, 12 indigo, 13 violet, 14 magenta, 15 pink. A host note/CC with value v lights the pad in its host colour at brightness v/127.

## KEYS

Scales (JAMbo's Scales.swift): 0 Major, 1 Minor, 2 Dorian, 3 Phrygian, 4 Lydian, 5 Mixolydian, 6 Locrian, 7 Harmonic minor, 8 Pentatonic major, 9 Pentatonic minor, 10 Chromatic; as a 12-bit mask (bit k = k semitones above the root).
Lowest note = 12 · (octave + 1) + root (JAMbo's keyboard; 48 = C3). Rows counted from the bottom of the unit as it sits (vr = 0..3), columns from the left:
- CHROMATIC: note = lowest + vr · row step + column; in the scale if its interval from the root is in the mask; the root is lit in the root colour, other scale notes in the scale colour, the rest in the out-of-scale colour (default off; they still play).
- IN KEY: degree k = vr · row step + column; note = lowest + 12 · ⌊k / n⌋ + steps[k mod n] (n notes in the scale).

## Velocity

Linear velocity x = (peak · gain/100 − on) · 127 / (full − on), clamped 1..127. Output = min + f(u) · (max − min), u = (x − 1)/126, rounded:
LINEAR u, SOFT √u, HARD u², EXP (e^{3u} − 1)/(e^3 − 1), LOG ln(1 + 9u)/ln 10, S-CURVE 3u² − 2u³, CUSTOM — linear between the 5 points (÷127), FIXED — the fixed velocity.
Aftertouch: (raw · gain/100 − threshold) · 127 / (full − threshold), 0..127.

## Device settings (store key 30, 6 bytes)

format version, side, active profile, MIDI OUT thru, controls to MIDI OUT, Bluetooth on (1 by default). Profiles — store keys 31–34.

## Geometry

Physical numbering (open-smc-pad, matches the photo of the unit): knobs on the left (1–8 = 0–7, row by row from the bottom), pads 0 = bottom-left, rows upwards, buttons in a column on the right edge, top to bottom: BT, PAD BANK, KNOB BANK, ◀, ▶, PLAY, PAUSE, REC, SHIFT, NOTE REPEAT. LEFT = the unit turned by 180°. Check on the device with IDENTIFY.

## MIDI OUT (3.5 mm)

PC5, written by software at 31 250 baud (the core sets up no UART for it). THRU: CLOCK — F8, FA, FB, FC from USB; ALL — every message from USB except JAMboPAD SysEx (active sensing FE dropped). Controls to MIDI OUT: the controls' own messages too.

DIN_OUT (`F0 7D 4A 50 11 <packed MIDI bytes> F7`, firmware 0.7.0 and later; HELLO gives the version): the device unpacks the data and writes the bytes to MIDI OUT at once, whatever the THRU mode (OFF too). Any MIDI messages (Note On/Off, CC, Program Change, …), whole messages only. No reply. Empty data or broken packing (a high-bit byte with no bytes after it, high bits set for bytes that are not there) — nothing goes out. The app sets THRU to CLOCK (clock passes straight through, without SysEx) or OFF and sends its notes with DIN_OUT; the lighting feedback then stays off the jack. Over Bluetooth it does not work for now: BLE-MIDI carries no SysEx, so DIN_OUT is USB only. 0x10 is left unused.

## Bluetooth

Named JAMboPAD L / JAMboPAD R (by side). BLE-MIDI (standard service 03B80E5A-…; open-smc-pad's library: no SysEx) and a settings service for the configurator (Web Bluetooth):

- service 4a50c0f1-0b1e-4d1a-9a7d-7d4a50000001, characteristic 4a50c0f1-0b1e-4d1a-9a7d-7d4a50000002 (write, write without response, notify);
- the same SysEx as over USB, as plain bytes in pieces of up to 20 bytes both ways (fits any ATT MTU).

Firmware is written over USB only (the bootloader is USB DFU).
