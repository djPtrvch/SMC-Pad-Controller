# JamboPad SysEx protocol (format version 1)

Every message: `F0 7D 4A 50 <cmd> <data…> F7` (0x7D — non-commercial ID, `4A 50` — "JP"). All data bytes are 7-bit.
A reply is the command `| 0x40`, its first data byte is the status: 0 OK, 1 bad arguments, 2 storage error.
Implementations: firmware/JamboPad/jp_engine.cpp, web/src/protocol.ts.

## Commands (host → device)

| cmd | name | data | reply data |
|---|---|---|---|
| 01 | HELLO | — | status, fw major, minor, patch, format version, side, active profile, profile count |
| 02 | GET_PROFILE | p | status, p, profile (packed, 368 bytes) |
| 03 | SET_PROFILE | p, profile (packed) | status, p — applied at once if p is active; kept in RAM until SAVE |
| 04 | SAVE | — | status — writes the device settings and changed profiles to flash |
| 05 | SELECT | p | status, p — saved at once |
| 06 | SET_SIDE | 0 RIGHT, 1 LEFT | status, side — saved at once; profiles stay (FACTORY_RESET rebuilds them for the side) |
| 07 | MONITOR | 0/1 | status — events 60 and 61 while on |
| 08 | SET_RGB | pad, r, g, b (0..127) | none — the pad shows this colour (LED modes HOST, BOTH); pad 127 clears all |
| 09 | BOOTLOADER | — | status, then the device restarts into DFU (USB 1209:0002) |
| 0A | FACTORY_RESET | — | status — 4 default profiles for the side, profile 1 active |
| 0B | IDENTIFY | 0/1 | status — while on, controls send event 62 instead of MIDI |

## Events (device → host)

| cmd | name | data |
|---|---|---|
| 60 | PRESSURE | 16 × (low 7 bits, high 3 bits) raw pressure 0..1023, physical pad order, every 33 ms |
| 61 | HIT | pad, peak low 7, peak high 3, linear velocity, output velocity |
| 62 | IDENTIFY | kind (0 pad, 1 button, 2 knob), physical index, value (velocity / 127 down, 0 up / 64 + delta) |
| 63 | PROFILE | p — selected on the device (PAD BANK + KNOB BANK held, then a pad of the top row) |

## Packing

8-bit data is sent as groups of up to 7 bytes: first a byte with the high bits (bit k = byte k's bit 7), then the 7 bytes' low 7 bits. 322 bytes → 368.

## Profile (322 bytes)

| offset | size | field |
|---|---|---|
| 0 | 1 | format version (1) |
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
| 49 | 34 × 8 | controls, physical order: pads 0–15, buttons 16–25, knobs 26–33 |
| 321 | 1 | LED mode: 0 LOCAL, 1 HOST, 2 BOTH |

Control (8 bytes): type (0 OFF, 1 NOTE, 2 CC, 3 PC; knobs — OFF or CC), channel 0–15, number, mode, a, b, c, d.
- pad: mode 0 MOMENTARY / 1 TOGGLE; a idle colour, b pressed colour, c host colour (palette 0–15).
- button: mode 0 MOMENTARY / 1 TOGGLE.
- knob: mode 0 ABSOLUTE, 1 RELATIVE OFFSET 64, 2 RELATIVE 2'S COMPLEMENT, 3 RELATIVE SIGNED BIT; a min, b max (a > b — inverted), c speed (steps per detent, 1–16).

Palette: 0 off, 1 white, 2 red, 3 orange-red, 4 orange, 5 yellow, 6 lime, 7 green, 8 mint, 9 cyan, 10 sky, 11 blue, 12 indigo, 13 violet, 14 magenta, 15 pink. A host note/CC with value v lights the pad in its host colour at brightness v/127.

## Velocity

Linear velocity x = (peak · gain/100 − on) · 127 / (full − on), clamped 1..127. Output = min + f(u) · (max − min), u = (x − 1)/126, rounded:
LINEAR u, SOFT √u, HARD u², EXP (e^{3u} − 1)/(e^3 − 1), LOG ln(1 + 9u)/ln 10, S-CURVE 3u² − 2u³, CUSTOM — linear between the 5 points (÷127), FIXED — the fixed velocity.
Aftertouch: (raw · gain/100 − threshold) · 127 / (full − threshold), 0..127.

## Device settings (store key 20, 3 bytes)

format version, side, active profile. Profiles — store keys 21–24.

## Geometry

Physical numbering (open-smc-pad): pads 0 = bottom-left, rows upwards; buttons in panel order (BLUETOOTH, PAD BANK, KNOB BANK, ◀, ▶, PLAY, PAUSE, REC, SHIFT, NOTE REPEAT); knobs 1–8 = 0–7, row by row from the bottom. LEFT = the unit turned by 180°. Check on the device with IDENTIFY.
