#!/usr/bin/env python3
"""
FLIRC -> SoundStream Roon volume bridge (Raspberry Pi)

- Reads FLIRC keyboard-like events from /dev/input
- Sends /api/roon/volume { action: up|down, step }
- Supports press and "hold ramp" (even if FLIRC doesn't emit repeats)
"""

import os
import time
import threading
import errno
from typing import Optional

import requests
from evdev import InputDevice, ecodes  # type: ignore


API_BASE = os.getenv("SOUNDSTREAM_API_URL", "http://192.168.0.21:3000").rstrip("/")
STEP = int(os.getenv("ROON_STEP", "1"))
REPEAT_S = float(os.getenv("ROON_REPEAT_S", "0.06"))  # hold ramp cadence
DEVICE_PATH = os.getenv("FLIRC_DEVICE", "/dev/input/flirc-kbd")
HTTP_TIMEOUT_S = float(os.getenv("HTTP_TIMEOUT_S", "1.5"))
GRAB = os.getenv("FLIRC_GRAB", "1") != "0"  # prevent keystrokes affecting the console by default
LOG_API = os.getenv("ROON_LOG_API", "0") == "1"

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
          if LOG_API:
            print(f"[{ts()}] API {action}({step}) -> {int(v)}")
          return int(v)
      except Exception:
        return None
    return None
  except Exception:
    return None


class HoldWorker:
  def __init__(self, action: str):
    self.action = action  # "up" or "down"
    self.stop_event = threading.Event()
    self.thread: Optional[threading.Thread] = None
    self.running = False

  def start(self) -> None:
    if self.running:
      return
    self.stop_event.clear()
    self.running = True
    self.thread = threading.Thread(target=self._run, daemon=True)
    self.thread.start()

  def stop(self) -> None:
    self.stop_event.set()
    self.running = False

  def _run(self) -> None:
    # Request-driven ramp: send the next step only after previous request completes,
    # and stop quickly when stop_event is set.
    while not self.stop_event.is_set():
      post_volume(self.action, STEP)
      if self.stop_event.wait(REPEAT_S):
        break


def main() -> None:
  print(f"[{ts()}] SoundStream FLIRC listener starting")
  print(f"[{ts()}] API={API_BASE} step={STEP} repeat={REPEAT_S}s device={DEVICE_PATH} grab={GRAB}")
  print(f"[{ts()}] Mapping: up={KEY_UP} down={KEY_DOWN}")

  up_worker = HoldWorker("up")
  down_worker = HoldWorker("down")
  up_held = False
  down_held = False

  while True:
    try:
      dev = InputDevice(DEVICE_PATH)
      if GRAB:
        try:
          dev.grab()
        except Exception as e:
          print(f"[{ts()}] WARN: could not grab device: {e}")

      for ev in dev.read_loop():
        if ev.type != ecodes.EV_KEY:
          continue

        key = ev.code
        val = ev.value  # 0=up, 1=down, 2=repeat

        # Ignore auto-repeat events; our hold loop is timer/request-driven.
        if val == 2:
          continue

        if key == KEY_UP:
          if val == 1 and not up_held:
            up_held = True
            print(f"[{ts()}] KeyDown UP -> hold start")
            up_worker.start()
          elif val == 0 and up_held:
            up_held = False
            print(f"[{ts()}] KeyUp UP -> hold stop")
            up_worker.stop()

        elif key == KEY_DOWN:
          if val == 1 and not down_held:
            down_held = True
            print(f"[{ts()}] KeyDown DOWN -> hold start")
            down_worker.start()
          elif val == 0 and down_held:
            down_held = False
            print(f"[{ts()}] KeyUp DOWN -> hold stop")
            down_worker.stop()

    except FileNotFoundError:
      # Device not present yet; wait and retry.
      time.sleep(0.5)
      continue
    except OSError as e:
      # Common when device is unplugged/replugged: "No such device"
      if getattr(e, "errno", None) in (errno.ENODEV, errno.ENOENT):
        print(f"[{ts()}] Device disappeared, retrying...")
        time.sleep(0.5)
        continue
      raise


if __name__ == "__main__":
  main()


