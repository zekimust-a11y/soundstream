import Foundation
import IOKit.hid
import Darwin

// Simple FLIRC HID listener that translates key presses into Soundstream Roon volume API calls.
// Intended to run on the server host (e.g. 192.168.0.21) where FLIRC is plugged in.
//
// Env:
// - SOUNDSTREAM_API_URL (default: http://127.0.0.1:3000)
// - ROON_STEP (default: 1)               // percent step per tick
// - ROON_REPEAT_INTERVAL_MS (default: 50) // repeat cadence when holding (ms)
//
// Usage:
//   SOUNDSTREAM_API_URL=http://127.0.0.1:3000 ROON_STEP=1 ROON_REPEAT_INTERVAL_MS=90 swift scripts/flirc-roon-volume.swift

let apiBase = ProcessInfo.processInfo.environment["SOUNDSTREAM_API_URL"] ?? "http://127.0.0.1:3000"
let step = Int(ProcessInfo.processInfo.environment["ROON_STEP"] ?? "1") ?? 1
let logRawEvents = (ProcessInfo.processInfo.environment["ROON_LOG_RAW"] ?? "0") == "1"

let stateLock = NSLock()
var pressedUp = false
var pressedDown = false
var lastRelevantEventAt: TimeInterval = Date().timeIntervalSince1970
var inFlight = false
var pendingSteps: Int = 0

// Ensure logs are flushed even when stdout is piped (e.g. through tee).
setbuf(stdout, nil)
setbuf(stderr, nil)

func ts() -> String {
  let f = ISO8601DateFormatter()
  return f.string(from: Date())
}

func postJSON(path: String, body: [String: Any]) {
  guard let url = URL(string: apiBase + path) else {
    print("[\(ts())] ❌ invalid URL: \(apiBase + path)")
    return
  }

  var req = URLRequest(url: url)
  req.httpMethod = "POST"
  req.setValue("application/json", forHTTPHeaderField: "Content-Type")
  do {
    req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
  } catch {
    print("[\(ts())] ❌ JSON encode error: \(error)")
    return
  }

  let task = URLSession.shared.dataTask(with: req) { data, resp, err in
    stateLock.lock()
    inFlight = false
    stateLock.unlock()

    if let err = err {
      print("[\(ts())] ❌ API error: \(err)")
      drainQueue()
      return
    }
    let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
    let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    print("[\(ts())] API \(path) -> \(status) \(text)")
    drainQueue()
  }
  task.resume()
}

// HID usage pages
let kPageKeyboard: Int = 0x07
let kPageConsumer: Int = 0x0C

// Keyboard usages (page 0x07)
let kUsageArrowUp: Int = 0x52
let kUsageArrowDown: Int = 0x51
// Some FLIRC profiles map remote buttons to function keys
let kUsageF9: Int = 0x42
let kUsageF10: Int = 0x43

// Consumer page usages (page 0x0C)
let kUsageConsumerVolumeIncrement: Int = 0xE9
let kUsageConsumerVolumeDecrement: Int = 0xEA

func fire(action: String, label: String) {
  print("[\(ts())] Key: \(label) -> Roon volume \(action) (\(step))")
  postJSON(path: "/api/roon/volume", body: ["action": action, "value": step])
}

func drainQueue() {
  stateLock.lock()
  if inFlight {
    stateLock.unlock()
    return
  }
  // Priority: while holding, keep stepping in that direction (no backlog).
  // Otherwise, drain queued discrete taps.
  let wantUp = pressedUp
  let wantDown = pressedDown
  var next: Int = 0
  if wantUp {
    next = 1
  } else if wantDown {
    next = -1
  } else if pendingSteps != 0 {
    next = pendingSteps > 0 ? 1 : -1
    pendingSteps += (pendingSteps > 0 ? -1 : 1)
  }
  if next == 0 {
    stateLock.unlock()
    return
  }
  inFlight = true
  stateLock.unlock()

  if next > 0 {
    fire(action: wantUp ? "up" : "up", label: wantUp ? "hold" : "tap")
  } else {
    fire(action: wantDown ? "down" : "down", label: wantDown ? "hold" : "tap")
  }
}

// IOHID callback
let callback: IOHIDValueCallback = { _ctx, _result, _sender, value in
  let element = IOHIDValueGetElement(value)
  let page = IOHIDElementGetUsagePage(element)
  let usage = IOHIDElementGetUsage(element)

  let intValue = IOHIDValueGetIntegerValue(value)
  if logRawEvents {
    // Log raw events for troubleshooting release behavior (FLIRC varies by profile)
    if usage == 0 || usage == 0xFFFFFFFF ||
      (page == kPageKeyboard && (usage == kUsageF9 || usage == kUsageF10 || usage == kUsageArrowUp || usage == kUsageArrowDown)) ||
      (page == kPageConsumer && (usage == kUsageConsumerVolumeIncrement || usage == kUsageConsumerVolumeDecrement)) {
      print("[\(ts())] RAW page=0x\(String(Int(page), radix: 16)) usage=0x\(String(Int(usage), radix: 16)) value=\(intValue)")
    }
  }
  // Some FLIRC profiles emit sentinels rather than true key-up events.
  // Empirically, intValue==0 for these tends to correlate with "release".
  if usage == 0 || usage == 0xFFFFFFFF {
    if intValue == 0 {
      stateLock.lock()
      pressedUp = false
      pressedDown = false
      pendingSteps = 0
      lastRelevantEventAt = Date().timeIntervalSince1970
      stateLock.unlock()
    }
    return
  }

  // Map pressed events only. (FLIRC will generate repeats while held.)
  let isUp =
    (page == kPageKeyboard && (usage == kUsageArrowUp || usage == kUsageF10)) ||
    (page == kPageConsumer && usage == kUsageConsumerVolumeIncrement)
  let isDown =
    (page == kPageKeyboard && (usage == kUsageArrowDown || usage == kUsageF9)) ||
    (page == kPageConsumer && usage == kUsageConsumerVolumeDecrement)

  if !isUp && !isDown {
    if intValue > 0 {
      print("[\(ts())] Key press (unmapped): page=0x\(String(Int(page), radix: 16)) usage=0x\(String(Int(usage), radix: 16))")
    }
    return
  }

  // Treat intValue>0 as press and intValue==0 as release when available.
  if intValue > 0 {
    stateLock.lock()
    let wasUp = pressedUp
    let wasDown = pressedDown
    if isUp { pressedUp = true }
    if isDown { pressedDown = true }
    lastRelevantEventAt = Date().timeIntervalSince1970
    stateLock.unlock()

    // Queue one step for presses (even if a request is already in-flight).
    // This preserves "5 rapid taps => 5%" behavior.
    stateLock.lock()
    if isUp && !wasUp { pendingSteps += 1 }
    if isDown && !wasDown { pendingSteps -= 1 }
    stateLock.unlock()
    drainQueue()
    return
  }

  // Release
  stateLock.lock()
  if isUp { pressedUp = false }
  if isDown { pressedDown = false }
  let up = pressedUp
  let down = pressedDown
  lastRelevantEventAt = Date().timeIntervalSince1970
  stateLock.unlock()
  // If released, attempt to drain any remaining queued taps; holds will stop naturally.
  if !up && !down { drainQueue() }
}

print("[\(ts())] Starting FLIRC HID listener")
print("[\(ts())] API: \(apiBase)")
print("[\(ts())] Step: \(step)")
print("[\(ts())] Raw logging: \(logRawEvents ? "on" : "off")")

let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))

// Match keyboard + consumer devices (broad match; FLIRC usually presents as a keyboard)
let matchKeyboard: [String: Any] = [
  kIOHIDDeviceUsagePageKey as String: kPageKeyboard,
]
let matchConsumer: [String: Any] = [
  kIOHIDDeviceUsagePageKey as String: kPageConsumer,
]
IOHIDManagerSetDeviceMatchingMultiple(manager, [matchKeyboard as CFDictionary, matchConsumer as CFDictionary] as CFArray)

IOHIDManagerRegisterInputValueCallback(manager, callback, nil)
IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)

let openRes = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
if openRes != kIOReturnSuccess {
  print("[\(ts())] ❌ IOHIDManagerOpen failed: \(openRes)")
  exit(1)
}

print("[\(ts())] Listening... (press buttons on the skip1s remote)")
CFRunLoopRun()


