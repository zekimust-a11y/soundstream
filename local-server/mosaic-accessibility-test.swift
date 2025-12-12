#!/usr/bin/env swift
/**
 * Mosaic Accessibility Test Script
 * 
 * This script investigates whether the dCS Mosaic app exposes accessible UI elements
 * that can be used to control volume programmatically.
 * 
 * Prerequisites:
 * 1. Grant Terminal/your IDE accessibility permissions:
 *    System Settings > Privacy & Security > Accessibility > Add Terminal
 * 2. Have Mosaic app running (can be minimized)
 * 
 * Usage:
 *   swift mosaic-accessibility-test.swift
 * 
 * Or compile and run:
 *   swiftc -o mosaic-test mosaic-accessibility-test.swift
 *   ./mosaic-test
 */

import Cocoa
import ApplicationServices

// MARK: - Accessibility Permission Check

func checkAccessibilityPermission() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

// MARK: - Find Mosaic Application

func findMosaicApp() -> NSRunningApplication? {
    let workspace = NSWorkspace.shared
    
    // Try common bundle identifiers for Mosaic
    let possibleBundleIds = [
        "com.dcs.mosaic",
        "com.dcsltd.mosaic", 
        "uk.co.dcsltd.mosaic",
        "com.dCS.Mosaic"
    ]
    
    for bundleId in possibleBundleIds {
        if let app = workspace.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) {
            return app
        }
    }
    
    // Fallback: search by name
    return workspace.runningApplications.first { app in
        app.localizedName?.lowercased().contains("mosaic") == true
    }
}

// MARK: - Get UI Element Hierarchy

func getAttributeValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    return result == .success ? value : nil
}

func getStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    return getAttributeValue(element, attribute) as? String
}

func getArrayAttribute(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
    return getAttributeValue(element, attribute) as? [AXUIElement]
}

func getAttributeNames(_ element: AXUIElement) -> [String]? {
    var names: CFArray?
    let result = AXUIElementCopyAttributeNames(element, &names)
    return result == .success ? names as? [String] : nil
}

func printElementInfo(_ element: AXUIElement, indent: Int = 0) {
    let prefix = String(repeating: "  ", count: indent)
    
    let role = getStringAttribute(element, kAXRoleAttribute as String) ?? "Unknown"
    let title = getStringAttribute(element, kAXTitleAttribute as String) ?? ""
    let description = getStringAttribute(element, kAXDescriptionAttribute as String) ?? ""
    let value = getAttributeValue(element, kAXValueAttribute as String)
    let identifier = getStringAttribute(element, "AXIdentifier") ?? ""
    
    var info = "\(prefix)[\(role)]"
    if !title.isEmpty { info += " title=\"\(title)\"" }
    if !description.isEmpty { info += " desc=\"\(description)\"" }
    if !identifier.isEmpty { info += " id=\"\(identifier)\"" }
    if let val = value {
        info += " value=\(val)"
    }
    
    print(info)
    
    // Check for slider-like elements (potential volume controls)
    if role == "AXSlider" || role == "AXValueIndicator" {
        print("\(prefix)  ⚠️ POTENTIAL VOLUME CONTROL FOUND!")
        if let attrs = getAttributeNames(element) {
            print("\(prefix)  Attributes: \(attrs)")
        }
    }
}

func exploreElement(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 5) {
    if depth > maxDepth { return }
    
    printElementInfo(element, indent: depth)
    
    // Get children
    if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
        for child in children {
            exploreElement(child, depth: depth + 1, maxDepth: maxDepth)
        }
    }
}

// MARK: - Volume Control Search

func findVolumeControls(_ element: AXUIElement, path: String = "") -> [(AXUIElement, String)] {
    var results: [(AXUIElement, String)] = []
    
    let role = getStringAttribute(element, kAXRoleAttribute as String) ?? "Unknown"
    let title = (getStringAttribute(element, kAXTitleAttribute as String) ?? "").lowercased()
    let description = (getStringAttribute(element, kAXDescriptionAttribute as String) ?? "").lowercased()
    let identifier = (getStringAttribute(element, "AXIdentifier") ?? "").lowercased()
    
    let currentPath = path.isEmpty ? role : "\(path) > \(role)"
    
    // Check if this might be a volume control
    let isSlider = role == "AXSlider" || role == "AXValueIndicator"
    let hasVolumeKeyword = title.contains("volume") || description.contains("volume") || identifier.contains("volume")
    
    if isSlider || hasVolumeKeyword {
        results.append((element, currentPath))
    }
    
    // Recurse into children
    if let children = getArrayAttribute(element, kAXChildrenAttribute as String) {
        for child in children {
            results.append(contentsOf: findVolumeControls(child, path: currentPath))
        }
    }
    
    return results
}

// MARK: - Window Location

func getWindowInfo(_ app: AXUIElement) {
    print("\n📍 Window Information:")
    print("=" .padding(toLength: 50, withPad: "=", startingAt: 0))
    
    if let windows = getArrayAttribute(app, kAXWindowsAttribute as String) {
        print("Found \(windows.count) window(s)")
        
        for (index, window) in windows.enumerated() {
            let title = getStringAttribute(window, kAXTitleAttribute as String) ?? "Untitled"
            
            var positionRef: CFTypeRef?
            var sizeRef: CFTypeRef?
            
            AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &positionRef)
            AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeRef)
            
            print("\nWindow \(index + 1): \"\(title)\"")
            
            if let positionValue = positionRef {
                var point = CGPoint.zero
                AXValueGetValue(positionValue as! AXValue, .cgPoint, &point)
                print("  Position: (\(Int(point.x)), \(Int(point.y)))")
            }
            
            if let sizeValue = sizeRef {
                var size = CGSize.zero
                AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
                print("  Size: \(Int(size.width)) x \(Int(size.height))")
            }
            
            // Check if minimized
            if let minimized = getAttributeValue(window, kAXMinimizedAttribute as String) as? Bool {
                print("  Minimized: \(minimized)")
            }
        }
    } else {
        print("❌ Could not access windows")
    }
}

// MARK: - Main

print("""
╔══════════════════════════════════════════════════════════════╗
║           dCS Mosaic Accessibility Investigation             ║
╚══════════════════════════════════════════════════════════════╝
""")

// Check permissions
print("🔐 Checking Accessibility Permissions...")
if !checkAccessibilityPermission() {
    print("❌ Accessibility permission required!")
    print("   Please grant permission in:")
    print("   System Settings > Privacy & Security > Accessibility")
    exit(1)
}
print("✅ Accessibility permission granted\n")

// Find Mosaic
print("🔍 Searching for Mosaic app...")
guard let mosaicApp = findMosaicApp() else {
    print("❌ Mosaic app not found!")
    print("   Please ensure Mosaic is running (can be in background)")
    print("\n   Available apps:")
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        print("   - \(app.localizedName ?? "Unknown") (\(app.bundleIdentifier ?? "no bundle id"))")
    }
    exit(1)
}

print("✅ Found Mosaic: \(mosaicApp.localizedName ?? "Mosaic")")
print("   Bundle ID: \(mosaicApp.bundleIdentifier ?? "Unknown")")
print("   PID: \(mosaicApp.processIdentifier)")

let axApp = AXUIElementCreateApplication(mosaicApp.processIdentifier)

// Get window info
getWindowInfo(axApp)

// Explore UI hierarchy
print("\n📊 UI Element Hierarchy (first 5 levels):")
print("=" .padding(toLength: 50, withPad: "=", startingAt: 0))
exploreElement(axApp, maxDepth: 5)

// Search for volume controls
print("\n🎚️ Searching for Volume Controls:")
print("=" .padding(toLength: 50, withPad: "=", startingAt: 0))
let volumeControls = findVolumeControls(axApp)

if volumeControls.isEmpty {
    print("❌ No obvious volume controls found")
    print("   This could mean:")
    print("   1. Mosaic doesn't expose volume as an accessible element")
    print("   2. The volume control uses a non-standard UI element")
    print("   3. The app may need to be in foreground/focused")
} else {
    print("✅ Found \(volumeControls.count) potential volume control(s):")
    for (element, path) in volumeControls {
        print("\n  Path: \(path)")
        if let attrs = getAttributeNames(element) {
            print("  Available attributes: \(attrs)")
        }
        if let value = getAttributeValue(element, kAXValueAttribute as String) {
            print("  Current value: \(value)")
        }
        if let minValue = getAttributeValue(element, kAXMinValueAttribute as String) {
            print("  Min value: \(minValue)")
        }
        if let maxValue = getAttributeValue(element, kAXMaxValueAttribute as String) {
            print("  Max value: \(maxValue)")
        }
    }
}

// Summary
print("\n" + "=" .padding(toLength: 60, withPad: "=", startingAt: 0))
print("📋 SUMMARY")
print("=" .padding(toLength: 60, withPad: "=", startingAt: 0))

let hasAccessibleUI = getArrayAttribute(axApp, kAXChildrenAttribute as String)?.isEmpty == false
print("Accessible UI Elements: \(hasAccessibleUI ? "✅ Yes" : "❌ No")")
print("Volume Controls Found: \(volumeControls.isEmpty ? "❌ None" : "✅ \(volumeControls.count)")")

if !hasAccessibleUI {
    print("""
    
    ⚠️ Mosaic may not expose accessible UI elements.
    Alternative approaches:
    1. Use AppleScript/JXA to simulate menu commands
    2. Use CGEvent to simulate mouse/keyboard input
    3. Control volume via LMS player (digital attenuation)
    """)
}

print("\n✅ Investigation complete!")
