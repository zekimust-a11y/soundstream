import Foundation
import IOKit.hid

// Simple FLIRC HID listener that translates key presses into Soundstream Roon volume API calls.
// Intended to run on the server host (e.g. 192.168.0.21) where FLIRC is plugged in.
//
// Env:
// - SOUNDSTREAM_API_URL (default: http://127.0.0.1:3000)
// - ROON_STEP (default: 1)               // percent step per tick
// - ROON_REPEAT_INTERVAL_MS (default: 90) // repeat cadence when holding (ms)
//
// Usage:
//   SOUNDSTREAM_API_URL=http://127.0.0.1:3000 ROON_STEP=1 ROON_REPEAT_INTERVAL_MS=90 swift scripts/flirc-roon-volume.swift

let apiBase = ProcessInfo.processInfo.environment["SOUNDSTREAM_API_URL"] ?? "http://127.0.0.1:3000"
let step = Int(ProcessInfo.processInfo.environment["ROON_STEP"] ?? "1") ?? 1
let repeatIntervalMs = Int(ProcessInfo.processInfo.environment["ROON_REPEAT_INTERVAL_MS"] ?? "90") ?? 90

let stateLock = NSLock()
var pressedUp = false
var pressedDown = false
var repeatTimer: DispatchSourceTimer? = nil

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
    if let err = err {
      print("[\(ts())] ❌ API error: \(err)")
      return
    }
    let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
    let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    print("[\(ts())] API \(path) -> \(status) \(text)")
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

func ensureTimerRunning() {
  if repeatTimer != nil { return }
  let t = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
  t.schedule(deadline: .now() + .milliseconds(repeatIntervalMs), repeating: .milliseconds(repeatIntervalMs))
  t.setEventHandler {
    stateLock.lock()
    let up = pressedUp
    let down = pressedDown
    stateLock.unlock()

    if up { fire(action: "up", label: "hold") }
    if down { fire(action: "down", label: "hold") }
    if !up && !down { stopTimer() }
  }
  repeatTimer = t
  t.resume()
}

func stopTimer() {
  if let t = repeatTimer {
    repeatTimer = nil
    t.cancel()
  }
}

// IOHID callback
let callback: IOHIDValueCallback = { _ctx, _result, _sender, value in
  let element = IOHIDValueGetElement(value)
  let page = IOHIDElementGetUsagePage(element)
  let usage = IOHIDElementGetUsage(element)

  let intValue = IOHIDValueGetIntegerValue(value)
  if usage == 0 { return }
  // FLIRC often emits this sentinel during key sequences; it is NOT a reliable release signal.
  if usage == 0xFFFFFFFF { return }

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
    stateLock.unlock()

    // Fire once on the initial press (ignore subsequent repeats from FLIRC)
    if isUp && !wasUp { fire(action: "up", label: "press") }
    if isDown && !wasDown { fire(action: "down", label: "press") }
    ensureTimerRunning()
    return
  }

  // Release
  stateLock.lock()
  if isUp { pressedUp = false }
  if isDown { pressedDown = false }
  let up = pressedUp
  let down = pressedDown
  stateLock.unlock()
  if !up && !down { stopTimer() }
}

print("[\(ts())] Starting FLIRC HID listener")
print("[\(ts())] API: \(apiBase)")
print("[\(ts())] Step: \(step)")
print("[\(ts())] Repeat interval: \(repeatIntervalMs)ms")

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


