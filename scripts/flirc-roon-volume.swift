import Foundation
import IOKit.hid

// Simple FLIRC HID listener that translates key presses into Soundstream Roon volume API calls.
// Intended to run on the server host (e.g. 192.168.0.21) where FLIRC is plugged in.
//
// Env:
// - SOUNDSTREAM_API_URL (default: http://127.0.0.1:3000)
// - ROON_STEP (default: 1)               // percent step per tick
// - ROON_MIN_INTERVAL_MS (default: 60)    // throttle repeated events (helps smooth holds)
//
// Usage:
//   SOUNDSTREAM_API_URL=http://127.0.0.1:3000 ROON_STEP=1 ROON_MIN_INTERVAL_MS=60 swift scripts/flirc-roon-volume.swift

let apiBase = ProcessInfo.processInfo.environment["SOUNDSTREAM_API_URL"] ?? "http://127.0.0.1:3000"
let step = Int(ProcessInfo.processInfo.environment["ROON_STEP"] ?? "1") ?? 1
let minIntervalMs = Int(ProcessInfo.processInfo.environment["ROON_MIN_INTERVAL_MS"] ?? "60") ?? 60
let throttleLock = NSLock()
var lastActionAt: [String: TimeInterval] = [:] // action -> timestamp

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
  let now = Date().timeIntervalSince1970
  throttleLock.lock()
  defer { throttleLock.unlock() }

  let last = lastActionAt[action] ?? 0
  if now - last < (Double(minIntervalMs) / 1000.0) {
    return
  }
  lastActionAt[action] = now

  print("[\(ts())] Key: \(label) -> Roon volume \(action) (\(step))")
  postJSON(path: "/api/roon/volume", body: ["action": action, "value": step])
}

// IOHID callback
let callback: IOHIDValueCallback = { _ctx, _result, _sender, value in
  let element = IOHIDValueGetElement(value)
  let page = IOHIDElementGetUsagePage(element)
  let usage = IOHIDElementGetUsage(element)

  let intValue = IOHIDValueGetIntegerValue(value)
  if usage == 0 { return }
  if usage == 0xFFFFFFFF { return }
  if intValue <= 0 { return }

  // Map pressed events only. (FLIRC will generate repeats while held.)
  if page == kPageKeyboard && usage == kUsageArrowUp { fire(action: "up", label: "ArrowUp"); return }
  if page == kPageKeyboard && usage == kUsageArrowDown { fire(action: "down", label: "ArrowDown"); return }
  if page == kPageKeyboard && usage == kUsageF10 { fire(action: "up", label: "F10"); return }
  if page == kPageKeyboard && usage == kUsageF9 { fire(action: "down", label: "F9"); return }
  if page == kPageConsumer && usage == kUsageConsumerVolumeIncrement { fire(action: "up", label: "ConsumerVolumeIncrement"); return }
  if page == kPageConsumer && usage == kUsageConsumerVolumeDecrement { fire(action: "down", label: "ConsumerVolumeDecrement"); return }
}

print("[\(ts())] Starting FLIRC HID listener")
print("[\(ts())] API: \(apiBase)")
print("[\(ts())] Step: \(step)")
print("[\(ts())] Min interval: \(minIntervalMs)ms")

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


