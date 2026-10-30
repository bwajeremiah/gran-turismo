# GT7 Telemetry Dashboard & Driving Coach

Real-time telemetry dashboard and AI driving coach for **Gran Turismo 7**. Captures live data from your PlayStation via UDP telemetry, displays it on any device with a browser (optimized for iPad), and analyzes your driving to help you get faster.
This is 100% free!!
Find your computer's IP with `ifconfig` (macOS) or `ip addr` (Linux).
## Features

### Live Telemetry Dashboard
- **Speed, RPM, Gear** with large, glanceable display
- **Throttle & Brake** vertical bars
- **RPM bar** with redline flash warning
- **Tire temperatures** (FL/FR/RL/RR) with color coding (cold/optimal/hot)
- **Tire slip detection** — lockup and wheelspin warnings
- **G-force meter** — real-time lateral/longitudinal G with trail
- **Turbo boost** indicator
- **Oil & water temperature**
- **Fuel level** with laps-remaining prediction
- **Race position** (1st/2nd/3rd...)
- **Lap times** — current, best, last

### Track Map
- **Speed-colored track map** — built in real-time from car position data
- Color gradient from blue (slow) → green → yellow → red (fast)
- Live car position dot

### Sector Times
- Track auto-divided into **3 sectors**
- Sector times for every lap in a table
- Color-coded: purple (best overall), green (improved), red (slower)
- Live current-lap sectors

### AI Driving Coach
- **Delta time** — ahead/behind your best lap in real-time
- **Speed comparison** — current vs reference at every point
- **Driving tips**: `BRAKE LATER`, `MORE THROTTLE`, `CARRY MORE SPEED`, `BRAKE NOW!`, `GOOD SPEED!`
- **Full-screen alerts** — impossible-to-miss colored bars for braking and shifting
- **Voice coaching** — spoken calls using your own recorded clips (see below)

### Voice Coaching
- Spoken calls for braking, throttle, speed, trail braking, gear shifts and pit stops
- Plays **your own mp3 recordings** from `static/audio/`
- Anything without a recording (speeds, distances) falls back to the device's built-in voice
- Tap the **Voice** button (bottom-left of the dashboard) once to enable audio — browsers, especially iOS, require a tap before they allow sound. Tap again to mute.

### Gear Shift Assistant
- **Automatic gear limit learning** — detects max speed per gear for any car
- **Shift up/down indicators** with distance warnings (e.g., `↓ 3 in 50m`)
- **Reference gear display** — shows what gear the best lap used at each point
- **Speed ceiling alerts** — `LIMIT ↑ 5 (max 256)` when hitting a gear's top speed
- Works from lap 1 — no reference needed for basic shift advice

### Post-Lap Error Analysis
- After each lap, detailed **error report** comparing to your best
- Track divided into **20 zones**, each analyzed for:
  - **Early/late braking** (with distance in meters)
  - **Slow corner speed** (delta in mph)
  - **Slow exit speed**
  - **Wrong gear selection**
  - **Unnecessary braking**
- Time lost/gained per zone
- Top 5 errors sorted by severity
- Improvements highlighted in green

## Requirements

- **Gran Turismo 7** running on PS4 or PS5
- **Python 3.10+** on a computer on the same network
- A **browser** to view the dashboard (iPad, phone, laptop, etc.)

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/plirex/gran-turismo.git
cd gran-turismo
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```
or 
use the GitHub desktop app
to clone

### 2. Find your PlayStation's IP address

On your PS4/PS5: **Settings → Network → View Connection Status** — note the IP address.

### 3. Run

```bash
./run.sh --console-ip YOUR_PS_IP
```
Or directly:
```bash(better option)
.venv/bin/python server.py --console-ip 192.168.1.100
dont forget to use your consoles ip   
```
if, ".venv/bin/python server.py --console-ip 192.168.1.100"    doesn't work do,
python server.py --console-ip 192.168.1.100    
### 4. Open dashboard

On your iPad/phone/laptop browser, go to:

```
http://YOUR_COMPUTER_IP:8080 

(other device)

use this instead if you wnat to see on the same device it is running on
http://localhost:8080
```
Find your computer's IP with `ifconfig` (macOS) or `ip addr` (Linux).

### 5. Start a race in GT7
(if you wnat it to already have track data wait for the demo track to run before you start)

The dashboard will automatically connect when you're on track. Telemetry is only sent during gameplay (not in menus).

## Voice Setup

Put `voice.js` in `static/` and your mp3 files in `static/audio/` (create the folder). Use these exact names:

| Category | Files |
|----------|-------|
| Braking | `brake_later.mp3`, `brake_now.mp3`, `brake_to.mp3`, `trail_brake.mp3`, `trail_brake_good.mp3` |
| Throttle / speed | `more_throttle.mp3`, `apply_throttle.mp3`, `hold_speed.mp3`, `good_speed.mp3`, `carry_more_speed.mp3` |
| Gear shifts | `shift_up.mp3`, `shift_down.mp3`, `upshift_limit.mp3`, `downshift.mp3` |
| Pit | `pit_in.mp3` |
| Gear numbers | `1.mp3` through `8.mp3` (`9.mp3`, `10.mp3` optional) |
| Status (optional) | `recording_lap.mp3`, `comparing.mp3` |

How calls are spoken:

- **Shift calls** — `shift_up` + gear number, e.g. "Shift up ... 4"
- **Brake zones** — `brake_to` + the target speed in mph (device voice), e.g. "Brake to 85"
- **Carry more speed** — used instead of "Hold speed" when you are 15+ km/h slower than the reference
- Missing mp3? That call is spoken by the device voice instead, so nothing is silent

Tuning options (on/off switches, distances, cooldowns) are at the top of `voice.py`.

## Command Line Options

```
python server.py [--console-ip IP] [--port PORT]

  --console-ip    PlayStation IP address (default: 192.168.112.107)
  --port          Web server port (default: 8080)
```

## How It Works

1. The server sends a UDP heartbeat to your PlayStation on port 33739
2. GT7 responds with telemetry packets (296 bytes, 60Hz) encrypted with Salsa20
3. Packets are decrypted, parsed, and broadcast to connected browsers via WebSocket
4. The driving coach records every lap and compares to your best in real-time
5. Post-lap analysis identifies specific errors and time losses

## Architecture

```
PlayStation (GT7)
    │ UDP telemetry (60Hz, Salsa20 encrypted)
    ▼
server.py ─── gt7_packet.py (decrypt + parse)
    │         coach.py (real-time comparison)
    │         analyzer.py (post-lap analysis)
    │         voice.py (turns tips into spoken-clip events)
    │ WebSocket (30Hz)  +  /ws/voice (voice events)
    ▼
Browser (iPad/phone/laptop)
    └── static/index.html + style.css + app.js + voice.js (+ audio/*.mp3)
```

## Tips

- **iPad fullscreen**: Add to Home Screen for a fullscreen app experience (uses `apple-mobile-web-app-capable`)
- **Multiple devices**: Any number of browsers can connect simultaneously
- **Car changes**: Gear limits auto-reset when you switch cars (detected via RPM limit change)
- **New track**: Track map and sectors auto-rebuild on each session
- **Best lap reference**: Updates automatically when you set a new personal best

## Supported Data (GT7 Telemetry Packet)

| Field | Source |
|-------|--------|
| Position (X/Y/Z) | 0x04-0x0F |
| Velocity (X/Y/Z) | 0x10-0x1B |
| Rotation (Pitch/Yaw/Roll) | 0x1C-0x27 |
| Engine RPM | 0x3C |
| Fuel level/capacity | 0x44-0x4B |
| Speed (m/s) | 0x4C |
| Turbo boost | 0x50 |
| Oil pressure/temp | 0x54-0x5F |
| Water temp | 0x58 |
| Tire temps (4 wheels) | 0x60-0x6F |
| Lap/time data | 0x70-0x7F |
| Race position | 0x84-0x87 |
| RPM limits | 0x88-0x8B |
| Gear/Throttle/Brake | 0x90-0x92 |
| Tire angular speed | 0xA4-0xB3 |
| Tire diameter | 0xB4-0xC3 |
| Suspension travel | 0xC4-0xD3 |
| Gear ratios | 0x100-0x123 |

## License

MIT
