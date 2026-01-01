import Foundation
import IOKit.hid

// Simple FLIRC HID listener that translates key presses into Soundstream Roon volume API calls.
// Intended to run on the server host (e.g. 192.168.0.21) where FLIRC is plugged in.
//
// Env:
// - SOUNDSTREAM_API_URL (default: http://127.0.0.1:3000)
// - ROON_STEP (default: 2)
//
// Usage:
//   SOUNDSTREAM_API_URL=http://127.0.0.1:3000 ROON_STEP=2 swift scripts/flirc-roon-volume.swift

let apiBase = ProcessInfo.processInfo.environment["SOUNDSTREAM_API_URL"] ?? "http://127.0.0.1:3000"
let step = Int(ProcessInfo.processInfo.environment["ROON_STEP"] ?? "2") ?? 2

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

// Consumer page usages (page 0x0C)
let kUsageConsumerVolumeIncrement: Int = 0xE9
let kUsageConsumerVolumeDecrement: Int = 0xEA

func handlePress(page: Int, usage: Int) {
  if page == kPageKeyboard && usage == kUsageArrowUp {
    print("[\(ts())] Key: ArrowUp -> Roon volume up (\(step))")
    postJSON(path: "/api/roon/volume", body: ["action": "up", "value": step])
    return
  }
  if page == kPageKeyboard && usage == kUsageArrowDown {
    print("[\(ts())] Key: ArrowDown -> Roon volume down (\(step))")
    postJSON(path: "/api/roon/volume", body: ["action": "down", "value": step])
    return
  }
  if page == kPageConsumer && usage == kUsageConsumerVolumeIncrement {
    print("[\(ts())] Key: ConsumerVolumeIncrement -> Roon volume up (\(step))")
    postJSON(path: "/api/roon/volume", body: ["action": "up", "value": step])
    return
  }
  if page == kPageConsumer && usage == kUsageConsumerVolumeDecrement {
    print("[\(ts())] Key: ConsumerVolumeDecrement -> Roon volume down (\(step))")
    postJSON(path: "/api/roon/volume", body: ["action": "down", "value": step])
    return
  }

  print("[\(ts())] Key press (unmapped): page=0x\(String(page, radix: 16)) usage=0x\(String(usage, radix: 16))")
}

// IOHID callback
let callback: IOHIDValueCallback = { _ctx, _result, _sender, value in
  let element = IOHIDValueGetElement(value)
  let page = IOHIDElementGetUsagePage(element)
  let usage = IOHIDElementGetUsage(element)

  // Only act on "pressed" (non-zero) values
  let intValue = IOHIDValueGetIntegerValue(value)
  if intValue == 0 { return }

  handlePress(page: Int(page), usage: Int(usage))
}

print("[\(ts())] Starting FLIRC HID listener")
print("[\(ts())] API: \(apiBase)")
print("[\(ts())] Step: \(step)")

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


