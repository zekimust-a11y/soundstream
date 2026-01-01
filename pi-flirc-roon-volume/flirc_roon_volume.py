#!/usr/bin/env python3
"""
FLIRC -> SoundStream Roon volume bridge (Raspberry Pi)

- Reads FLIRC keyboard-like events from /dev/input
- Sends /api/roon/volume { action: up|down, step }
- Supports press and "hold ramp" (even if FLIRC doesn't emit repeats)
"""

import os
import time
from typing import Optional

import requests
from evdev import InputDevice, ecodes  # type: ignore


API_BASE = os.getenv("SOUNDSTREAM_API_URL", "http://192.168.0.21:3000").rstrip("/")
STEP = int(os.getenv("ROON_STEP", "1"))
REPEAT_S = float(os.getenv("ROON_REPEAT_S", "0.06"))  # hold ramp cadence
DEVICE_PATH = os.getenv("FLIRC_DEVICE", "/dev/input/flirc")
HTTP_TIMEOUT_S = float(os.getenv("HTTP_TIMEOUT_S", "1.5"))
GRAB = os.getenv("FLIRC_GRAB", "1") != "0"  # prevent keystrokes affecting the console by default

# Default mapping (matches your current FLIRC setup on macOS):
KEY_UP = int(os.getenv("FLIRC_KEY_UP", str(ecodes.KEY_F10)))
KEY_DOWN = int(os.getenv("FLIRC_KEY_DOWN", str(ecodes.KEY_F9)))


def ts() -> str:
  return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def post_volume(action: str, step: int) -> Optional[int]:
  try:
    r = requests.post(
      f"{API_BASE}/api/roon/volume",
      json={"action": action, "step": step},
      timeout=HTTP_TIMEOUT_S,
    )
    # best-effort parse; server returns {"success":true,"volume":N}
    if r.ok:
      try:
        data = r.json()
        v = data.get("volume")
        if isinstance(v, (int, float)):
          return int(v)
      except Exception:
        return None
    return None
  except Exception:
    return None


def main() -> None:
  print(f"[{ts()}] SoundStream FLIRC listener starting")
  print(f"[{ts()}] API={API_BASE} step={STEP} repeat={REPEAT_S}s device={DEVICE_PATH} grab={GRAB}")
  print(f"[{ts()}] Mapping: up={KEY_UP} down={KEY_DOWN}")

  dev = InputDevice(DEVICE_PATH)
  if GRAB:
    try:
      dev.grab()
    except Exception as e:
      print(f"[{ts()}] WARN: could not grab device: {e}")

  held_up = False
  held_down = False
  last_up = 0.0
  last_down = 0.0

  for ev in dev.read_loop():
    if ev.type != ecodes.EV_KEY:
      continue

    key = ev.code
    val = ev.value  # 0=up, 1=down, 2=repeat (if emitted)

    now = time.time()

    if key == KEY_UP:
      if val == 1:
        held_up = True
        print(f"[{ts()}] KeyDown UP -> volume up ({STEP})")
        post_volume("up", STEP)
        last_up = now
      elif val == 0:
        held_up = False
        print(f"[{ts()}] KeyUp UP")
      elif val == 2:
        held_up = True

    elif key == KEY_DOWN:
      if val == 1:
        held_down = True
        print(f"[{ts()}] KeyDown DOWN -> volume down ({STEP})")
        post_volume("down", STEP)
        last_down = now
      elif val == 0:
        held_down = False
        print(f"[{ts()}] KeyUp DOWN")
      elif val == 2:
        held_down = True

    # Manual hold ramp: we do this on *any* key event to keep things simple.
    # It still feels smooth because FLIRC emits frequent events while held,
    # and if it does not, you can re-program FLIRC to emit repeats.
    now = time.time()
    if held_up and (now - last_up) >= REPEAT_S:
      post_volume("up", STEP)
      last_up = now
    if held_down and (now - last_down) >= REPEAT_S:
      post_volume("down", STEP)
      last_down = now


if __name__ == "__main__":
  main()


