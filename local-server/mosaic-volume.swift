#!/usr/bin/env swift
/**
 * Mosaic Volume Control CLI
 * 
 * Control dCS Mosaic app volume via macOS accessibility APIs.
 * 
 * Prerequisites:
 * 1. Grant Terminal/your IDE accessibility permissions:
 *    System Settings > Privacy & Security > Accessibility > Add Terminal
 * 2. Have Mosaic app running (can be minimized)
 * 
 * Usage:
 *   swift mosaic-volume.swift --get              # Get current volume
 *   swift mosaic-volume.swift --set 75           # Set volume to 75%
 *   swift mosaic-volume.swift --up [amount]      # Volume up (default 5%)
 *   swift mosaic-volume.swift --down [amount]    # Volume down (default 5%)
 *   swift mosaic-volume.swift --mute             # Toggle mute
 * 
 * Or compile for faster execution:
 *   swiftc -O -o mosaic-volume mosaic-volume.swift
 *   ./mosaic-volume --set 75
 * 
 * Output:
 *   JSON format: {"success": true, "volume": 75} or {"success": false, "error": "message"}
 */

import Cocoa
import ApplicationServices
import Foundation

// MARK: - JSON Output

struct Result: Codable {
    let success: Bool
    let volume: Double?
    let muted: Bool?
    let error: String?
    
    init(success: Bool, volume: Double? = nil, muted: Bool? = nil, error: String? = nil) {
        self.success = success
        self.volume = volume
        self.muted = muted
        self.error = error
    }
}

func output(_ result: Result) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []
    if let data = try? encoder.encode(result),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    }
    exit(result.success ? 0 : 1)
}

func exitWithError(_ message: String) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []
    if let data = try? encoder.encode(Result(success: false, error: message)),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    }
    exit(1)
}

// MARK: - Accessibility Helpers

func checkAccessibilityPermission() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

func getAttributeValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    return result == .success ? value : nil
}

func setAttributeValue(_ element: AXUIElement, _ attribute: String, _ value: CFTypeRef) -> Bool {
    let result = AXUIElementSetAttributeValue(element, attribute as CFString, value)
    return result == .success
}

func getStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    return getAttributeValue(element, attribute) as? String
}

func getNumberAttribute(_ element: AXUIElement, _ attribute: String) -> Double? {
    if let value = getAttributeValue(element, attribute) {
        if let num = value as? NSNumber {
            return num.doubleValue
        }
    }
    return nil
}

func getBoolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
    if let value = getAttributeValue(element, attribute) as? NSNumber {
        return value.boolValue
    }
    return nil
}

func getArrayAttribute(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
    return getAttributeValue(element, attribute) as? [AXUIElement]
}

func performAction(_ element: AXUIElement, _ action: String) -> Bool {
    return AXUIElementPerformAction(element, action as CFString) == .success
}

// MARK: - Find Mosaic Application

func findMosaicApp() -> NSRunningApplication? {
    let workspace = NSWorkspace.shared
    
    let possibleBundleIds = [
        "com.dcs.mosaic",
        "com.dcsltd.mosaic", 
        "uk.co.dcsltd.mosaic",
        "com.dCS.Mosaic",
        "com.dcs.Mosaic"
    ]
    
    for bundleId in possibleBundleIds {
        if let app = workspace.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) {
            return app
        }
    }
    
    return workspace.runningApplications.first { app in
        app.localizedName?.lowercased().contains("mosaic") == true
    }
}

// MARK: - Find Volume Slider

func findVolumeSlider(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 15) -> AXUIElement? {
    if depth > maxDepth { return nil }
    
    let role = getStringAttribute(element, kAXRoleAttribute as String) ?? ""
    let subrole = getStringAttribute(element, kAXSubroleAttribute as String) ?? ""
    let title = (getStringAttribute(element, kAXTitleAttribute as String) ?? "").lowercased()
    let description = (getStringAttribute(element, kAXDescriptionAttribute as String) ?? "").lowercased()
    let identifier = (getStringAttribute(element, "AXIdentifier") ?? "").lowercased()
    let label = (getStringAttribute(element, kAXLabelValueAttribute as String) ?? "").lowercased()
    
    let adjustableRoles = ["AXSlider", "AXValueIndicator", "AXIncrementor", "AXStepper"]
    let isAdjustable = adjustableRoles.contains(role)
    let hasVolumeKeyword = title.contains("volume") || description.contains("volume") || 
                           identifier.contains("volume") || label.contains("volume") ||
                           title.contains("level") || description.contains("level")
    
    if isAdjustable && hasVolumeKeyword {
        return element
    }
    
    if isAdjustable {
        let minVal = getNumberAttribute(element, kAXMinValueAttribute as String)
        let maxVal = getNumberAttribute(element, kAXMaxValueAttribute as String)
        let value = getNumberAttribute(element, kAXValueAttribute as String)
        if (minVal != nil && maxVal != nil) || value != nil {
            if maxVal ?? 0 > 0 {
                return element
            }
        }
    }
    
    if role == "AXGroup" || role == "AXScrollArea" || role == "AXSplitGroup" {
        if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
            for child in children {
                if let found = findVolumeSlider(child, depth: depth + 1, maxDepth: maxDepth) {
                    return found
                }
            }
        }
    }
    
    if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
        for child in children {
            if let found = findVolumeSlider(child, depth: depth + 1, maxDepth: maxDepth) {
                return found
            }
        }
    }
    
    return nil
}

func getActions(_ element: AXUIElement) -> [String] {
    var actionsRef: CFArray?
    let result = AXUIElementCopyActionNames(element, &actionsRef)
    if result == .success, let actions = actionsRef as? [String] {
        return actions
    }
    return []
}

func getAllAdjustableElements(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 15) -> [[String: Any]] {
    var results: [[String: Any]] = []
    if depth > maxDepth { return results }
    
    let role = getStringAttribute(element, kAXRoleAttribute as String) ?? ""
    let subrole = getStringAttribute(element, kAXSubroleAttribute as String) ?? ""
    let title = getStringAttribute(element, kAXTitleAttribute as String) ?? ""
    let description = getStringAttribute(element, kAXDescriptionAttribute as String) ?? ""
    let identifier = getStringAttribute(element, "AXIdentifier") ?? ""
    let label = getStringAttribute(element, kAXLabelValueAttribute as String) ?? ""
    let value = getNumberAttribute(element, kAXValueAttribute as String)
    let minVal = getNumberAttribute(element, kAXMinValueAttribute as String)
    let maxVal = getNumberAttribute(element, kAXMaxValueAttribute as String)
    let actions = getActions(element)
    
    let hasAdjustableActions = actions.contains("AXIncrement") || actions.contains("AXDecrement")
    let adjustableRoles = ["AXSlider", "AXValueIndicator", "AXIncrementor", "AXStepper"]
    let isAdjustable = adjustableRoles.contains(role) || hasAdjustableActions
    
    if isAdjustable || value != nil || (minVal != nil && maxVal != nil) {
        results.append([
            "role": role,
            "subrole": subrole,
            "title": title,
            "description": description,
            "identifier": identifier,
            "label": label,
            "value": value ?? 0,
            "min": minVal ?? 0,
            "max": maxVal ?? 0,
            "actions": actions,
            "depth": depth
        ])
    }
    
    if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
        for child in children {
            results.append(contentsOf: getAllAdjustableElements(child, depth: depth + 1, maxDepth: maxDepth))
        }
    }
    
    return results
}

func findRotaryDial(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 15) -> AXUIElement? {
    if depth > maxDepth { return nil }
    
    let actions = getActions(element)
    let hasIncrementDecrement = actions.contains("AXIncrement") && actions.contains("AXDecrement")
    
    if hasIncrementDecrement {
        let value = getNumberAttribute(element, kAXValueAttribute as String)
        if value != nil {
            return element
        }
    }
    
    if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
        for child in children {
            if let found = findRotaryDial(child, depth: depth + 1, maxDepth: maxDepth) {
                return found
            }
        }
    }
    
    return nil
}

func findMuteButton(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 10) -> AXUIElement? {
    if depth > maxDepth { return nil }
    
    let role = getStringAttribute(element, kAXRoleAttribute as String) ?? ""
    let title = (getStringAttribute(element, kAXTitleAttribute as String) ?? "").lowercased()
    let description = (getStringAttribute(element, kAXDescriptionAttribute as String) ?? "").lowercased()
    let identifier = (getStringAttribute(element, "AXIdentifier") ?? "").lowercased()
    
    let isButton = role == "AXButton" || role == "AXCheckBox" || role == "AXToggle"
    let hasMuteKeyword = title.contains("mute") || description.contains("mute") || identifier.contains("mute")
    
    if isButton && hasMuteKeyword {
        return element
    }
    
    if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
        for child in children {
            if let found = findMuteButton(child, depth: depth + 1, maxDepth: maxDepth) {
                return found
            }
        }
    }
    
    return nil
}

func getAllSliders(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 10) -> [AXUIElement] {
    var sliders: [AXUIElement] = []
    if depth > maxDepth { return sliders }
    
    let role = getStringAttribute(element, kAXRoleAttribute as String) ?? ""
    
    if role == "AXSlider" {
        sliders.append(element)
    }
    
    if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
        for child in children {
            sliders.append(contentsOf: getAllSliders(child, depth: depth + 1, maxDepth: maxDepth))
        }
    }
    
    return sliders
}

// MARK: - Volume Control Functions

func getVolume(_ slider: AXUIElement) -> Double? {
    guard let currentValue = getNumberAttribute(slider, kAXValueAttribute as String),
          let minValue = getNumberAttribute(slider, kAXMinValueAttribute as String),
          let maxValue = getNumberAttribute(slider, kAXMaxValueAttribute as String) else {
        return nil
    }
    
    let range = maxValue - minValue
    if range <= 0 { return nil }
    
    let normalized = (currentValue - minValue) / range * 100
    return max(0, min(100, normalized))
}

func setVolume(_ slider: AXUIElement, percent: Double) -> Bool {
    guard let minValue = getNumberAttribute(slider, kAXMinValueAttribute as String),
          let maxValue = getNumberAttribute(slider, kAXMaxValueAttribute as String) else {
        return false
    }
    
    let clamped = max(0, min(100, percent))
    let range = maxValue - minValue
    let newValue = minValue + (clamped / 100.0 * range)
    
    return setAttributeValue(slider, kAXValueAttribute as String, NSNumber(value: newValue))
}

func toggleMute(_ button: AXUIElement) -> Bool {
    return performAction(button, kAXPressAction as String)
}

// MARK: - Mouse Drag Simulation

func getWindowPosition(_ app: NSRunningApplication) -> CGPoint? {
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    
    guard let windows = getArrayAttribute(axApp, kAXWindowsAttribute as String),
          !windows.isEmpty else {
        return nil
    }
    
    for window in windows {
        let title = getStringAttribute(window, kAXTitleAttribute as String) ?? ""
        if title.lowercased().contains("volume") {
            if let posValue = getAttributeValue(window, kAXPositionAttribute as String) {
                var point = CGPoint.zero
                AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
                
                if let sizeValue = getAttributeValue(window, kAXSizeAttribute as String) {
                    var size = CGSize.zero
                    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
                    return CGPoint(x: point.x + size.width / 2, y: point.y + size.height / 2)
                }
            }
        }
    }
    
    if let posValue = getAttributeValue(windows[0], kAXPositionAttribute as String) {
        var point = CGPoint.zero
        AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
        
        if let sizeValue = getAttributeValue(windows[0], kAXSizeAttribute as String) {
            var size = CGSize.zero
            AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
            return CGPoint(x: point.x + size.width / 2, y: point.y + size.height / 2)
        }
    }
    
    return nil
}

func simulateDrag(from start: CGPoint, deltaY: CGFloat, app: NSRunningApplication) -> Bool {
    app.activate(options: [])
    usleep(200000)
    
    let moveToStart = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: start, mouseButton: .left)
    moveToStart?.post(tap: .cghidEventTap)
    usleep(50000)
    
    let mouseDown = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)
    mouseDown?.post(tap: .cghidEventTap)
    usleep(50000)
    
    let steps = 10
    let stepSize = deltaY / CGFloat(steps)
    var currentY = start.y
    
    for _ in 0..<steps {
        currentY += stepSize
        let dragPoint = CGPoint(x: start.x, y: currentY)
        let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: dragPoint, mouseButton: .left)
        drag?.post(tap: .cghidEventTap)
        usleep(20000)
    }
    
    let endPoint = CGPoint(x: start.x, y: start.y + deltaY)
    let mouseUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: endPoint, mouseButton: .left)
    mouseUp?.post(tap: .cghidEventTap)
    
    return true
}

func adjustVolumeByDrag(amount: Double, app: NSRunningApplication) -> Bool {
    guard let dialCenter = getWindowPosition(app) else {
        return false
    }
    
    let dragDistance = CGFloat(-amount * 3)
    
    return simulateDrag(from: dialCenter, deltaY: dragDistance, app: app)
}

// MARK: - Main

func main() {
    let args = CommandLine.arguments
    
    if args.count < 2 {
        exitWithError("Usage: mosaic-volume --get | --set <value> | --up [amount] | --down [amount] | --mute | --list | --arrow-up [count] | --arrow-down [count]")
    }
    
    if !checkAccessibilityPermission() {
        exitWithError("Accessibility permission required. Grant in System Settings > Privacy & Security > Accessibility")
    }
    
    guard let mosaicApp = findMosaicApp() else {
        exitWithError("Mosaic app not found. Please ensure it is running.")
    }
    
    let axApp = AXUIElementCreateApplication(mosaicApp.processIdentifier)
    
    let command = args[1]
    
    switch command {
    case "--drag-up":
        let amount = args.count >= 3 ? (Double(args[2]) ?? 5.0) : 5.0
        if adjustVolumeByDrag(amount: amount, app: mosaicApp) {
            output(Result(success: true, message: "Dragged volume up by \(amount)"))
        } else {
            exitWithError("Failed to find Mosaic volume window. Make sure Volume Control panel is open.")
        }
        
    case "--drag-down":
        let amount = args.count >= 3 ? (Double(args[2]) ?? 5.0) : 5.0
        if adjustVolumeByDrag(amount: -amount, app: mosaicApp) {
            output(Result(success: true, message: "Dragged volume down by \(amount)"))
        } else {
            exitWithError("Failed to find Mosaic volume window. Make sure Volume Control panel is open.")
        }
        
    case "--list":
        let elements = getAllAdjustableElements(axApp)
        if let data = try? JSONSerialization.data(withJSONObject: ["success": true, "elements": elements, "count": elements.count], options: [.prettyPrinted]),
           let json = String(data: data, encoding: .utf8) {
            print(json)
        } else {
            print("{\"success\":true,\"elements\":[],\"count\":0}")
        }
        exit(0)
        
    case "--get":
        guard let slider = findVolumeSlider(axApp) else {
            exitWithError("Volume slider not found in Mosaic. Try bringing the app to foreground.")
        }
        
        guard let volume = getVolume(slider) else {
            exitWithError("Could not read volume value")
        }
        
        output(Result(success: true, volume: round(volume * 10) / 10))
        
    case "--set":
        guard args.count >= 3, let targetVolume = Double(args[2]) else {
            exitWithError("Usage: --set <volume 0-100>")
        }
        
        guard let slider = findVolumeSlider(axApp) else {
            exitWithError("Volume slider not found in Mosaic. Try bringing the app to foreground.")
        }
        
        if setVolume(slider, percent: targetVolume) {
            usleep(100000)
            let newVolume = getVolume(slider) ?? targetVolume
            output(Result(success: true, volume: round(newVolume * 10) / 10))
        } else {
            exitWithError("Failed to set volume")
        }
        
    case "--up":
        let amount = args.count >= 3 ? (Double(args[2]) ?? 5.0) : 5.0
        
        guard let slider = findVolumeSlider(axApp) else {
            exitWithError("Volume slider not found in Mosaic. Try bringing the app to foreground.")
        }
        
        guard let currentVolume = getVolume(slider) else {
            exitWithError("Could not read current volume")
        }
        
        let newVolume = min(100, currentVolume + amount)
        if setVolume(slider, percent: newVolume) {
            usleep(100000)
            let actualVolume = getVolume(slider) ?? newVolume
            output(Result(success: true, volume: round(actualVolume * 10) / 10))
        } else {
            exitWithError("Failed to increase volume")
        }
        
    case "--down":
        let amount = args.count >= 3 ? (Double(args[2]) ?? 5.0) : 5.0
        
        guard let slider = findVolumeSlider(axApp) else {
            exitWithError("Volume slider not found in Mosaic. Try bringing the app to foreground.")
        }
        
        guard let currentVolume = getVolume(slider) else {
            exitWithError("Could not read current volume")
        }
        
        let newVolume = max(0, currentVolume - amount)
        if setVolume(slider, percent: newVolume) {
            usleep(100000)
            let actualVolume = getVolume(slider) ?? newVolume
            output(Result(success: true, volume: round(actualVolume * 10) / 10))
        } else {
            exitWithError("Failed to decrease volume")
        }
        
    case "--mute":
        if let muteButton = findMuteButton(axApp) {
            if toggleMute(muteButton) {
                usleep(100000)
                let isMuted = getBoolAttribute(muteButton, kAXValueAttribute as String)
                output(Result(success: true, muted: isMuted))
            } else {
                exitWithError("Failed to toggle mute")
            }
        } else {
            exitWithError("Mute button not found in Mosaic")
        }
        
    default:
        exitWithError("Unknown command: \(command). Use --get, --set, --up, --down, --mute, or --list")
    }
}

main()
