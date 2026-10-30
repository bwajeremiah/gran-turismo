"""Voice coaching: turns coach output into spoken-clip events for the browser.

The browser (static/voice.js) plays the mp3 files in static/audio/.
Anything that has no recording (speeds, distances) falls back to the
device's built-in voice, so it still works before every clip is recorded.
"""

import re
import time

KMH_TO_MPH = 0.621371

# ---- Tweak these -----------------------------------------------------------
SAY_GEAR_NUMBERS = True        # "Shift up ... 4"
SAY_POSITIVE = True            # "Good speed" / "Good trail braking"
ANNOUNCE_SHIFT_AHEAD = False   # "Shift up, 4, in 85 meters" (can get chatty)
BRAKE_ANNOUNCE_DIST = 150      # meters before the brake point to say "Brake to ..."
CARRY_SPEED_DELTA = -15        # km/h slower than reference -> "Carry more speed"
PIT_ANNOUNCE_PROGRESS = 0.85   # say "Pit in" this far (0-1) through the pit lap

# Clip name -> (fallback text, cooldown category, priority)
# Higher priority interrupts lower priority while it is speaking.
CLIPS = {
    'brake_now':        ('Brake now',                'brake',       100),
    'brake_to':         ('Brake to',                 'brake_ahead',  90),
    'brake_later':      ('Brake later',              'brake',        80),
    'upshift_limit':    ('Limit, upshift',           'shift',        75),
    'shift_up':         ('Shift up',                 'shift',        70),
    'shift_down':       ('Shift down',               'shift',        70),
    'downshift':        ('Downshift',                'shift',        70),
    'pit_in':           ('Pit in, pit in, pit in',   'pit',          65),
    'more_throttle':    ('More throttle',            'throttle',     50),
    'apply_throttle':   ('Apply throttle',           'throttle',     50),
    'hold_speed':       ('Hold speed',               'speed',        45),
    'carry_more_speed': ('Carry more speed',         'speed',        45),
    'trail_brake':      ('Trail brake',              'trail',        40),
    'trail_brake_good': ('Good trail braking',       'trail',        30),
    'good_speed':       ('Good speed',               'good',         20),
    'recording_lap':    ('Recording reference lap',  'status',       10),
    'comparing':        ('Comparing with best lap',  'status',       10),
}

# Minimum seconds between two clips of the same category
COOLDOWNS = {
    'brake': 1.5,
    'brake_ahead': 3.0,
    'shift': 2.5,
    'throttle': 3.0,
    'speed': 3.0,
    'trail': 3.0,
    'good': 6.0,
    'pit': 20.0,
    'status': 3.0,
}

# coach.py tip text (without trailing "!") -> clip name
TIP_TO_CLIP = {
    'BRAKE LATER': 'brake_later',
    'BRAKE NOW': 'brake_now',
    'GOOD SPEED': 'good_speed',
    'MORE THROTTLE': 'more_throttle',
    'HOLD SPEED': 'hold_speed',
    'APPLY THROTTLE': 'apply_throttle',
}

_GEAR_RE = re.compile(r'[\u2191\u2193]\s*(\d+)')
_DIST_RE = re.compile(r'in (\d+)m')


class VoiceCoach:
    """Watches coach output each frame and emits one-shot voice events."""

    def __init__(self):
        self._last_said = {}        # category -> monotonic time
        self._brake_key = None      # brake zone already announced
        self._pit_said_lap = -1
        self._prev_recording = False
        self._prev_has_ref = False

    # ------------------------------------------------------------------
    def _emit(self, events, clip, now, extra=None):
        text, cat, priority = CLIPS[clip]
        if now - self._last_said.get(cat, -1e9) < COOLDOWNS[cat]:
            return False
        self._last_said[cat] = now
        parts = [{'clip': clip, 'text': text}]
        if extra:
            parts.extend(extra)
        events.append({'id': clip, 'priority': priority, 'parts': parts})
        return True

    @staticmethod
    def _gear_part(tip):
        m = _GEAR_RE.search(tip)
        if not (m and SAY_GEAR_NUMBERS):
            return []
        gear = m.group(1)
        return [{'clip': gear, 'text': gear}]

    # ------------------------------------------------------------------
    def process(self, data, coaching, coach=None):
        """Return a list of voice events for this telemetry frame.

        Each event: {id, priority, parts: [{clip, text}, ...]}
        'clip' is an mp3 name (no extension) or None to use device voice.
        """
        now = time.monotonic()
        events = []

        # --- Status messages -------------------------------------------
        recording = bool(coaching.get('recording_demo'))
        if recording and not self._prev_recording:
            self._emit(events, 'recording_lap', now)
        self._prev_recording = recording

        has_ref = bool(coaching.get('has_reference'))
        if has_ref and not self._prev_has_ref:
            self._emit(events, 'comparing', now)
        self._prev_has_ref = has_ref

        # --- Brake / throttle / speed tips -----------------------------
        tip = (coaching.get('tip') or '').strip()
        if tip:
            clip = TIP_TO_CLIP.get(tip.rstrip('!').upper())
            if clip == 'hold_speed' and coaching.get('delta_speed', 0) <= CARRY_SPEED_DELTA:
                clip = 'carry_more_speed'
            if clip == 'good_speed' and not SAY_POSITIVE:
                clip = None
            if clip:
                self._emit(events, clip, now)

        # --- Trail braking ----------------------------------------------
        trail = (coaching.get('trail_brake_tip') or '').upper()
        if trail:
            if 'GOOD' in trail:
                if SAY_POSITIVE:
                    self._emit(events, 'trail_brake_good', now)
            else:
                self._emit(events, 'trail_brake', now)

        # --- Gear shifts --------------------------------------------------
        shift_tip = coaching.get('shift_tip') or ''
        shift_type = coaching.get('shift_type') or ''
        if shift_tip:
            clip = None
            extra = self._gear_part(shift_tip)
            if shift_type in ('up_now', 'down_now'):
                if shift_tip.startswith('LIMIT'):
                    clip = 'upshift_limit'
                elif shift_tip.startswith('DOWNSHIFT'):
                    clip = 'downshift'
                elif shift_type == 'up_now':
                    clip = 'shift_up'
                else:
                    clip = 'shift_down'
            elif ANNOUNCE_SHIFT_AHEAD and shift_type in ('up', 'down'):
                clip = 'shift_up' if shift_type == 'up' else 'shift_down'
                m = _DIST_RE.search(shift_tip)
                if m:
                    extra = extra + [{'clip': None, 'text': 'in ' + m.group(1) + ' meters'}]
            if clip:
                self._emit(events, clip, now, extra)

        # --- Upcoming brake zone: "Brake to <mph>" -------------------------
        info = coaching.get('brake_ahead')
        if info:
            key = (info.get('target_speed'), info.get('brake_speed'))
            if info.get('dist', 9999) <= BRAKE_ANNOUNCE_DIST and key != self._brake_key:
                mph = int(round(info.get('target_speed', 0) * KMH_TO_MPH / 5.0) * 5)
                extra = [{'clip': None, 'text': str(mph)}] if mph > 0 else []
                if self._emit(events, 'brake_to', now, extra):
                    self._brake_key = key
        else:
            self._brake_key = None

        # --- Pit call -----------------------------------------------------
        pit = coaching.get('pit') or {}
        pit_lap = pit.get('pit_lap', 0)
        lap = data.get('lap', 0)
        if pit_lap and pit_lap == lap and self._pit_said_lap != lap:
            progress = 1.0
            if coach is not None and getattr(coach, 'reference_lap', None):
                progress = coach._last_ref_idx / max(1, len(coach.reference_lap))
            if progress >= PIT_ANNOUNCE_PROGRESS:
                if self._emit(events, 'pit_in', now):
                    self._pit_said_lap = lap

        return events
