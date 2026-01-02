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
from typing import Optional, Callable

import requests
from evdev import InputDevice, ecodes  # type: ignore


API_BASE = os.getenv("SOUNDSTREAM_API_URL", "http://192.168.0.21:3000").rstrip("/")

# Tap step (single press)
TAP_STEP = int(os.getenv("ROON_STEP", "1"))

# Hold behavior:
# - We send ONE tap immediately on KeyDown.
# - We send ONE /api/roon/hold/start after HOLD_DELAY_S (or once repeats are observed),
#   and ONE /api/roon/hold/stop after release.
# Important: FLIRC can emit spurious KeyUp events during a long press (while repeats still
# arrive). To make holds reliable, we use a short "release grace" window and treat repeat
# (value=2) as evidence the key is still held.
HOLD_STEP = int(os.getenv("ROON_HOLD_STEP", str(TAP_STEP)))
HOLD_DELAY_S = float(os.getenv("ROON_HOLD_DELAY_S", "0.08"))
# Kept for backward compat / logging (we no longer HTTP-per-step).
HOLD_REPEAT_S = float(os.getenv("ROON_REPEAT_S", "0.03"))
HOLD_TICK_MS = int(float(os.getenv("ROON_HOLD_TICK_MS", "40")))
RELEASE_GRACE_MS = int(float(os.getenv("ROON_RELEASE_GRACE_MS", "180")))

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


def post_hold(action: str, direction: str, step: int, tick_ms: int) -> None:
  try:
    if action == "start":
      requests.post(
        f"{API_BASE}/api/roon/hold/start",
        json={"direction": direction, "step": step, "tickMs": tick_ms},
        timeout=HTTP_TIMEOUT_S,
      )
    else:
      requests.post(
        f"{API_BASE}/api/roon/hold/stop",
        json={},
        timeout=HTTP_TIMEOUT_S,
      )
  except Exception:
    pass


class HoldWorker:
  def __init__(self, action: str, is_active: Callable[[], bool]):
    self.action = action  # "up" or "down"
    self.stop_event = threading.Event()
    self.thread: Optional[threading.Thread] = None
    self.running = False
    self.is_active = is_active
    self.hold_started = False

  def start(self) -> None:
    if self.running:
      return
    self.stop_event.clear()
    self.running = True
    self.hold_started = False
    self.thread = threading.Thread(target=self._run, daemon=True)
    self.thread.start()

  def stop(self) -> None:
    self.stop_event.set()
    self.running = False

  def _run(self) -> None:
    # Server-side hold: one start call, then stop call on release.
    # Note: we only start the hold if the key is still considered active after HOLD_DELAY_S.
    if self.stop_event.wait(HOLD_DELAY_S):
      return
    if not self.is_active():
      return
    post_hold("start", self.action, HOLD_STEP, HOLD_TICK_MS)
    self.hold_started = True
    # Wait until stop, then send stop.
    self.stop_event.wait()
    if self.hold_started:
      post_hold("stop", self.action, HOLD_STEP, HOLD_TICK_MS)


def main() -> None:
  print(f"[{ts()}] SoundStream FLIRC listener starting")
  print(
    f"[{ts()}] API={API_BASE} tap_step={TAP_STEP} hold_step={HOLD_STEP} "
    f"hold_delay={HOLD_DELAY_S}s release_grace={RELEASE_GRACE_MS}ms repeat={HOLD_REPEAT_S}s device={DEVICE_PATH} grab={GRAB}"
  )
  print(f"[{ts()}] Mapping: up={KEY_UP} down={KEY_DOWN}")

  up_held = False
  down_held = False
  up_down_at = 0.0
  down_down_at = 0.0
  up_last_active_at = 0.0
  down_last_active_at = 0.0
  up_release_timer: Optional[threading.Timer] = None
  down_release_timer: Optional[threading.Timer] = None

  def up_is_active() -> bool:
    return up_held

  def down_is_active() -> bool:
    return down_held

  up_worker = HoldWorker("up", up_is_active)
  down_worker = HoldWorker("down", down_is_active)

  def cancel_timer(t: Optional[threading.Timer]) -> None:
    try:
      if t is not None:
        t.cancel()
    except Exception:
      pass

  def schedule_release(which: str) -> None:
    nonlocal up_release_timer, down_release_timer, up_held, down_held

    def do_release_up() -> None:
      nonlocal up_held
      # Only release if we haven't seen activity within the grace window.
      if time.time() - up_last_active_at < (RELEASE_GRACE_MS / 1000.0):
        return
      if up_held:
        up_held = False
        print(f"[{ts()}] KeyUp UP -> hold stop")
        up_worker.stop()

    def do_release_down() -> None:
      nonlocal down_held
      if time.time() - down_last_active_at < (RELEASE_GRACE_MS / 1000.0):
        return
      if down_held:
        down_held = False
        print(f"[{ts()}] KeyUp DOWN -> hold stop")
        down_worker.stop()

    delay_s = RELEASE_GRACE_MS / 1000.0
    if which == "up":
      cancel_timer(up_release_timer)
      up_release_timer = threading.Timer(delay_s, do_release_up)
      up_release_timer.daemon = True
      up_release_timer.start()
    else:
      cancel_timer(down_release_timer)
      down_release_timer = threading.Timer(delay_s, do_release_down)
      down_release_timer.daemon = True
      down_release_timer.start()

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

        now = time.time()

        if key == KEY_UP:
          if val in (1, 2):
            up_last_active_at = now
            # Any activity cancels pending release.
            cancel_timer(up_release_timer)
          if val == 1 and not up_held:
            up_held = True
            up_down_at = now
            print(f"[{ts()}] KeyDown UP -> tap + hold start")
            post_volume("up", TAP_STEP)
            up_worker.start()
          elif val == 0 and up_held:
            # Don't stop immediately; FLIRC may send spurious KeyUp while repeats are still coming.
            # We'll stop only if no activity arrives within RELEASE_GRACE_MS.
            schedule_release("up")
          elif val == 2 and up_held:
            # If repeats are arriving but the hold start delay hasn't elapsed yet, ensure we don't
            # miss starting the hold due to brief key-up blips.
            if (now - up_down_at) >= HOLD_DELAY_S and not up_worker.hold_started:
              # Best-effort: if the worker hasn't started yet, start it (it will fire immediately
              # if delay already elapsed and key is active).
              up_worker.start()

        elif key == KEY_DOWN:
          if val in (1, 2):
            down_last_active_at = now
            cancel_timer(down_release_timer)
          if val == 1 and not down_held:
            down_held = True
            down_down_at = now
            print(f"[{ts()}] KeyDown DOWN -> tap + hold start")
            post_volume("down", TAP_STEP)
            down_worker.start()
          elif val == 0 and down_held:
            schedule_release("down")
          elif val == 2 and down_held:
            if (now - down_down_at) >= HOLD_DELAY_S and not down_worker.hold_started:
              down_worker.start()

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


