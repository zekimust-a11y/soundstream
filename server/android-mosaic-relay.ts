/**
 * Android Mosaic ACTUS Relay Server
 * 
 * Uses Android emulator/device with Mosaic ACTUS app to control dCS Varese DAC volume.
 * 
 * Architecture:
 * SoundStream → Relay Server → ADB → Android Emulator → Mosaic ACTUS → dCS Varese (ACTUS)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import express, { Request, Response } from 'express';

const execAsync = promisify(exec);

interface AndroidMosaicRelayConfig {
  enabled: boolean;
  adbPath?: string;
  emulatorSerial?: string; // e.g., "emulator-5554" or device serial
  packageName?: string; // Mosaic ACTUS package name (auto-detected if not provided)
  volumeUpButton?: { x: number; y: number }; // Screen coordinates
  volumeDownButton?: { x: number; y: number };
  volumeSlider?: { x: number; y: number; width: number }; // For swipe gestures
}

class AndroidMosaicRelay {
  private config: AndroidMosaicRelayConfig;
  private currentVolumeDb: number = -40; // Current volume in dB (-80 to 0), default to -40dB (50%)
  private adbAvailable: boolean = false;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private lastVolumeControlTap: number = 0; // Timestamp of last volume icon tap
  
  // Volume range: -80dB (minimum/muted) to 0dB (maximum)
  private readonly MIN_DB = -80;
  private readonly MAX_DB = 0;
  
  // Keep volume control screen open by tapping just before timeout
  // Set to a safe interval that won't interfere with rapid volume changes
  // Typical Android timeout is 10-15 seconds, so use 8 seconds to be safe
  private readonly VOLUME_CONTROL_KEEPALIVE_INTERVAL = 8000; // 8 seconds (just before typical timeout)
  private readonly VOLUME_ICON_COORDS = { x: 972, y: 2121 }; // Center of volume display in bottom player bar
  
  // Convert percentage (0-100) to dB (-80 to 0)
  private percentToDb(percent: number): number {
    return this.MIN_DB + (percent / 100) * (this.MAX_DB - this.MIN_DB);
  }
  
  // Convert dB (-80 to 0) to percentage (0-100)
  private dbToPercent(db: number): number {
    return ((db - this.MIN_DB) / (this.MAX_DB - this.MIN_DB)) * 100;
  }

  constructor(config: AndroidMosaicRelayConfig) {
    this.config = {
      enabled: false,
      packageName: 'com.dcs.mosaic', // Common package names to try
      ...config,
    };
  }

  async initialize(): Promise<boolean> {
    if (!this.config.enabled) {
      console.log('[AndroidMosaicRelay] Disabled');
      return false;
    }

    try {
      // Check if ADB is available
      const adbCmd = this.config.adbPath || 'adb';
      await execAsync(`${adbCmd} version`);
      this.adbAvailable = true;
      console.log('[AndroidMosaicRelay] ADB available');

      // Check if device/emulator is connected
      const deviceSerial = this.config.emulatorSerial;
      if (deviceSerial) {
        const { stdout } = await execAsync(`${adbCmd} -s ${deviceSerial} get-state`);
        if (stdout.trim() !== 'device') {
          console.warn(`[AndroidMosaicRelay] Device ${deviceSerial} not ready: ${stdout.trim()}`);
          return false;
        }
        console.log(`[AndroidMosaicRelay] Connected to device: ${deviceSerial}`);
      } else {
        // Try to find any connected device
        const { stdout } = await execAsync(`${adbCmd} devices`);
        const devices = stdout.split('\n').filter(line => line.includes('\tdevice'));
        if (devices.length === 0) {
          console.warn('[AndroidMosaicRelay] No Android devices/emulators found');
          return false;
        }
        const firstDevice = devices[0].split('\t')[0];
        this.config.emulatorSerial = firstDevice;
        console.log(`[AndroidMosaicRelay] Using device: ${firstDevice}`);
      }

      // Check if Mosaic ACTUS app is installed
      const packageName = await this.findMosaicPackage();
      if (!packageName) {
        console.warn('[AndroidMosaicRelay] Mosaic ACTUS app not found');
        return false;
      }
      this.config.packageName = packageName;
      console.log(`[AndroidMosaicRelay] Found Mosaic ACTUS: ${packageName}`);

      // Try to detect volume controls
      await this.detectVolumeControls();

      return true;
    } catch (error) {
      console.error('[AndroidMosaicRelay] Initialization failed:', error);
      return false;
    }
  }

  private async findMosaicPackage(): Promise<string | null> {
    const adbCmd = this.config.adbPath || 'adb';
    const deviceFlag = this.config.emulatorSerial ? `-s ${this.config.emulatorSerial}` : '';
    
    // Common Mosaic ACTUS package names
    const possiblePackages = [
      'uk.co.dcsltd.mosaic2', // Mosaic ACTUS (most common)
      'com.dcs.mosaic',
      'com.dcsltd.mosaic',
      'uk.co.dcsltd.mosaic',
      'com.dCS.Mosaic',
    ];

    try {
      const { stdout } = await execAsync(`${adbCmd} ${deviceFlag} shell pm list packages`);
      const installedPackages = stdout.split('\n').map(line => line.replace('package:', '').trim());

      for (const pkg of possiblePackages) {
        if (installedPackages.includes(pkg)) {
          return pkg;
        }
      }

      // Search for packages containing "mosaic"
      const mosaicPackages = installedPackages.filter(pkg => 
        pkg.toLowerCase().includes('mosaic')
      );
      if (mosaicPackages.length > 0) {
        return mosaicPackages[0];
      }
    } catch (error) {
      console.error('[AndroidMosaicRelay] Error finding package:', error);
    }

    return null;
  }

  private async detectVolumeControls(): Promise<void> {
    // Use UI Automator to find volume controls
    // This is a placeholder - actual implementation would use:
    // adb shell uiautomator dump /dev/tty to get UI hierarchy
    // Then parse XML to find volume controls
    
    console.log('[AndroidMosaicRelay] Volume control detection not yet implemented');
    console.log('[AndroidMosaicRelay] You may need to manually configure button coordinates');
  }

  private async adbCommand(command: string): Promise<string> {
    const adbCmd = this.config.adbPath || 'adb';
    const deviceFlag = this.config.emulatorSerial ? `-s ${this.config.emulatorSerial}` : '';
    const fullCommand = `${adbCmd} ${deviceFlag} ${command}`;
    
    try {
      const { stdout, stderr } = await execAsync(fullCommand);
      if (stderr && !stderr.includes('Warning')) {
        throw new Error(stderr);
      }
      return stdout.trim();
    } catch (error) {
      throw new Error(`ADB command failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getVolume(): Promise<number> {
    if (!this.adbAvailable) {
      throw new Error('ADB not available');
    }

    // Try to read actual volume from UI, fallback to cached value
    try {
      const actualDb = await this.readVolumeFromUI();
      if (actualDb !== null) {
        this.currentVolumeDb = actualDb;
      }
    } catch (error) {
      // If we can't read from UI, use cached value
      console.log('[AndroidMosaicRelay] Could not read volume from UI, using cached value');
    }
    
    // Return as percentage (0-100) for API compatibility
    return this.dbToPercent(this.currentVolumeDb);
  }
  
  // Try to read the actual volume in dB from the Mosaic ACTUS UI
  private async readVolumeFromUI(): Promise<number | null> {
    try {
      // Dump UI and look for volume display (e.g., "-41.0 dB")
      await this.adbCommand('shell uiautomator dump /sdcard/ui-volume-read.xml');
      const uiXml = await this.adbCommand('shell cat /sdcard/ui-volume-read.xml');
      
      // Look for volume display pattern like "-41.0 dB" or "-41.0\ndB"
      const volumeMatch = uiXml.match(/(-?\d+\.?\d*)\s*[\\n]*\s*dB/i);
      if (volumeMatch) {
        const dbValue = parseFloat(volumeMatch[1]);
        if (!isNaN(dbValue) && dbValue >= this.MIN_DB && dbValue <= this.MAX_DB) {
          return dbValue;
        }
      }
    } catch (error) {
      // Silently fail - we'll use cached value
    }
    return null;
  }

  async setVolume(volume: number): Promise<void> {
    if (!this.adbAvailable) {
      throw new Error('ADB not available');
    }

    // Skip reading from UI for speed - use cached value
    // Reading from UI adds ~2-3 seconds delay which is too slow for slider control
    // We'll update the cache after setting volume

    // Convert percentage input to dB
    const targetVolumePercent = Math.max(0, Math.min(100, volume));
    const targetVolumeDb = this.percentToDb(targetVolumePercent);
    const currentVolDb = this.currentVolumeDb;
    const differenceDb = targetVolumeDb - currentVolDb;

    console.log(`[AndroidMosaicRelay] Setting volume: ${currentVolDb.toFixed(1)}dB → ${targetVolumeDb.toFixed(1)}dB (diff: ${differenceDb.toFixed(1)}dB)`);
    console.log(`[AndroidMosaicRelay] Percentage: ${this.dbToPercent(currentVolDb).toFixed(1)}% → ${targetVolumePercent.toFixed(1)}%`);

    // Check if change is significant (more than 0.5dB)
    if (Math.abs(differenceDb) < 0.5) {
      // Already at target volume
      console.log(`[AndroidMosaicRelay] Already at target volume`);
      return;
    }

    // Check if we're already at min/max and trying to go further
    if (currentVolDb <= this.MIN_DB && differenceDb < 0) {
      // Already at minimum (-80dB), can't go lower
      console.log(`[AndroidMosaicRelay] Already at minimum volume (${this.MIN_DB}dB)`);
      return;
    }
    if (currentVolDb >= this.MAX_DB && differenceDb > 0) {
      // Already at maximum (0dB), can't go higher
      console.log(`[AndroidMosaicRelay] Already at maximum volume (${this.MAX_DB}dB)`);
      return;
    }

    // Clamp current volume to valid dB range
    if (currentVolDb < this.MIN_DB) {
      this.currentVolumeDb = this.MIN_DB;
    } else if (currentVolDb > this.MAX_DB) {
      this.currentVolumeDb = this.MAX_DB;
    }
    
    // Calculate difference in percentage for swipe calculations
    // We need to know how much to move the wheel based on dB difference
    const currentPercent = this.dbToPercent(currentVolDb);
    const targetPercent = this.dbToPercent(targetVolumeDb);
    const differencePercent = Math.abs(targetPercent - currentPercent);
    const isVolumeUp = differenceDb > 0;
    
    console.log(`[AndroidMosaicRelay] Swipe: ${differencePercent.toFixed(1)}% ${isVolumeUp ? 'UP' : 'DOWN'}`);

    try {
      // DISABLED: Waiting for user to manually open app and verify clean state
      // Once we understand the app's default behavior, we'll implement volume control
      // For now, just update the cache and return
      console.log('[AndroidMosaicRelay] Volume control temporarily disabled - waiting for clean app state verification');
      this.currentVolumeDb = targetVolumeDb;
      console.log(`[AndroidMosaicRelay] Volume cache updated to ${targetVolumePercent}% (${targetVolumeDb.toFixed(1)}dB) - no UI interaction`);
      return;
      
      // TODO: Re-enable after verifying clean app state
      // The code below is commented out until we understand why search/sidebar keep appearing
      /*
      // Ensure app is in foreground
      await this.adbCommand(`shell am start -n ${this.config.packageName}/${this.config.packageName}.MainActivity`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Tap volume display to open volume control screen
      const now = Date.now();
      if (now - this.lastVolumeControlTap > 2000) {
        await this.adbCommand(`shell input tap ${this.VOLUME_ICON_COORDS.x} ${this.VOLUME_ICON_COORDS.y}`);
        this.lastVolumeControlTap = now;
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      // Perform volume swipe on the circular wheel
      if (this.config.volumeSlider) {
        await this.adjustVolumeBySwipe(differencePercent * (isVolumeUp ? 1 : -1));
      } else {
        await this.adjustVolumeByButtons(differencePercent * (isVolumeUp ? 1 : -1));
      }
      
      // Update cached volume in dB
      this.currentVolumeDb = targetVolumeDb;
      console.log(`[AndroidMosaicRelay] Volume set to ${targetVolumePercent}% (${targetVolumeDb.toFixed(1)}dB)`);
      */
    } catch (error) {
      console.error('[AndroidMosaicRelay] Failed to set volume:', error);
      throw error;
    }
  }

  private async adjustVolumeBySwipe(difference: number): Promise<void> {
    if (!this.config.volumeSlider) return;

    const { x, y, width } = this.config.volumeSlider;
    const steps = Math.abs(difference);
    const direction = difference > 0 ? 'right' : 'left';
    const swipeDistance = (width / 100) * steps; // Approximate

    // Swipe on volume slider
    const startX = x + (direction === 'right' ? 0 : swipeDistance);
    const endX = x + (direction === 'right' ? swipeDistance : 0);

    await this.adbCommand(`shell input swipe ${startX} ${y} ${endX} ${y} 300`);
  }

  private async adjustVolumeByButtons(difference: number): Promise<void> {
    // For circular wheel, we need to tap on the wheel rim (not center - that's the mute button!)
    // Volume wheel center is approximately at (540, 1092) based on UI analysis
    const wheelCenterX = 540;
    const wheelCenterY = 1092;
    
    // Tap slightly off-center on the wheel rim to avoid the mute button
    // For volume up: start on the right side of the wheel
    // For volume down: start on the left side of the wheel
    const wheelRadius = 150; // Approximate radius of the wheel
    const offsetFromCenter = 100; // Distance from center to tap (on the rim, not center)
    
    const absDifference = Math.abs(difference);
    const isVolumeUp = difference > 0;
    
    // For rapid slider movements, use single very fast swipe
    // Optimized for sub-second response time
    const swipes = 1; // Always single swipe for speed
    const swipeDuration = 100; // Very fast swipe (100ms) - feels like real drag
    const delayBetweenSwipes = 0; // No delays
    
    // Calculate swipe distance: scale with volume change
    // Larger changes need longer swipes
    // Base: 60px per 10% change, max 400px for very large changes
    const swipeDistance = Math.min(400, Math.max(20, absDifference * 6));
    
    console.log(`[AndroidMosaicRelay] Wheel swipe: ${swipes} swipes, distance: ${swipeDistance.toFixed(0)}px, direction: ${isVolumeUp ? 'UP' : 'DOWN'}`);
    
    for (let i = 0; i < swipes; i++) {
      // NOTE: The circular wheel direction might be inverted!
      // Testing shows dragging left-down increases volume, so we invert the logic
      if (isVolumeUp) {
        // Volume up: start on LEFT side, drag LEFT-DOWN (inverted!)
        // This seems to rotate the wheel to increase volume
        const startX = wheelCenterX - offsetFromCenter; // Left side of wheel
        const startY = wheelCenterY; // Same vertical level
        const endX = startX - swipeDistance;
        const endY = startY + swipeDistance;
        console.log(`[AndroidMosaicRelay] Swipe ${i+1}/${swipes} UP (inverted): (${startX}, ${startY}) → (${endX}, ${endY})`);
        // Tap on wheel rim, then swipe
        await this.adbCommand(`shell input tap ${startX} ${startY}`);
        await new Promise(resolve => setTimeout(resolve, 30)); // Brief pause to register tap
        // Swipe on the wheel
        await this.adbCommand(`shell input swipe ${startX} ${startY} ${endX} ${endY} ${swipeDuration}`);
      } else {
        // Volume down: start on RIGHT side, drag RIGHT-DOWN (inverted!)
        // This seems to rotate the wheel to decrease volume
        const startX = wheelCenterX + offsetFromCenter; // Right side of wheel
        const startY = wheelCenterY; // Same vertical level
        const endX = startX + swipeDistance;
        const endY = startY + swipeDistance;
        console.log(`[AndroidMosaicRelay] Swipe ${i+1}/${swipes} DOWN (inverted): (${startX}, ${startY}) → (${endX}, ${endY})`);
        // Tap on wheel rim, then swipe
        await this.adbCommand(`shell input tap ${startX} ${startY}`);
        await new Promise(resolve => setTimeout(resolve, 30)); // Brief pause to register tap
        // Swipe on the wheel
        await this.adbCommand(`shell input swipe ${startX} ${startY} ${endX} ${endY} ${swipeDuration}`);
      }
      // Delay between swipes (if any)
      if (i < swipes - 1 && delayBetweenSwipes > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenSwipes));
      }
    }
  }

  private async adjustVolumeByKeys(difference: number): Promise<void> {
    // Convert percentage difference to number of key presses
    // Each volume key press typically changes volume by 2-5%, so use 2% per press for safety
    const absDifference = Math.abs(difference);
    const keyPresses = Math.max(1, Math.ceil(absDifference / 2)); // At least 1 press, assume 2% per press
    const keyCode = difference > 0 ? 'KEYCODE_VOLUME_UP' : 'KEYCODE_VOLUME_DOWN';

    console.log(`[AndroidMosaicRelay] Sending ${keyPresses} ${keyCode} key events...`);
    
    // Send volume key events rapidly
    // No need to open app or UI - volume keys work system-wide
    for (let i = 0; i < keyPresses; i++) {
      await this.adbCommand(`shell input keyevent ${keyCode}`);
      // Very short delay between presses for rapid changes
      if (i < keyPresses - 1) {
        await new Promise(resolve => setTimeout(resolve, 50)); // 50ms between presses
      }
    }
    
    console.log(`[AndroidMosaicRelay] Sent ${keyPresses} volume key events`);
  }

  async volumeUp(step: number = 2): Promise<number> {
    // Step is in percentage, convert current dB to percent, add step, convert back
    const currentPercent = this.dbToPercent(this.currentVolumeDb);
    const newPercent = Math.min(100, currentPercent + step);
    await this.setVolume(newPercent);
    return newPercent;
  }

  async volumeDown(step: number = 2): Promise<number> {
    // Step is in percentage, convert current dB to percent, subtract step, convert back
    const currentPercent = this.dbToPercent(this.currentVolumeDb);
    const newPercent = Math.max(0, currentPercent - step);
    await this.setVolume(newPercent);
    return newPercent;
  }
  
  // Start keepalive to prevent volume control screen from timing out
  // DISABLED: Keepalive was triggering the floating menu
  // We'll rely on rapid volume changes to keep the screen active instead
  startKeepAlive(): void {
    // Make absolutely sure any existing keepalive is stopped
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    console.log('[AndroidMosaicRelay] Keepalive disabled - was triggering floating menu');
    // Keepalive disabled - the repeated taps were triggering the floating menu
    // Instead, we'll just open the volume control when needed for each volume change
  }
  
  // Stop keepalive
  stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('[AndroidMosaicRelay] Keepalive stopped');
    }
    // Also ensure the interval is null even if it wasn't set
    this.keepAliveInterval = null;
  }
}

// Singleton instance
let relayInstance: AndroidMosaicRelay | null = null;

export function initializeAndroidMosaicRelay(config: AndroidMosaicRelayConfig): AndroidMosaicRelay {
  relayInstance = new AndroidMosaicRelay(config);
  return relayInstance;
}

export function getAndroidMosaicRelay(): AndroidMosaicRelay | null {
  return relayInstance;
}

/**
 * Register Express routes for Android Mosaic relay
 */
export function registerAndroidMosaicRoutes(app: express.Application): void {
  // Get current volume
  app.get('/api/android-mosaic/volume', async (req: Request, res: Response) => {
    const relay = getAndroidMosaicRelay();
    if (!relay) {
      return res.status(503).json({ 
        error: 'Android Mosaic relay not initialized',
        hint: 'Enable it in server configuration'
      });
    }

    try {
      const volume = await relay.getVolume();
      res.json({ success: true, volume });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get volume',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Set volume
  app.post('/api/android-mosaic/volume', async (req: Request, res: Response) => {
    const relay = getAndroidMosaicRelay();
    if (!relay) {
      return res.status(503).json({ 
        error: 'Android Mosaic relay not initialized'
      });
    }

    const { action, value } = req.body;

    try {
      if (action === 'get') {
        const volume = await relay.getVolume();
        return res.json({ success: true, volume });
      } else if (action === 'set' && typeof value === 'number') {
        await relay.setVolume(value);
        return res.json({ success: true, volume: value });
      } else if (action === 'up') {
        const step = typeof value === 'number' ? value : 2;
        const newVolume = await relay.volumeUp(step);
        return res.json({ success: true, volume: newVolume });
      } else if (action === 'down') {
        const step = typeof value === 'number' ? value : 2;
        const newVolume = await relay.volumeDown(step);
        return res.json({ success: true, volume: newVolume });
      } else {
        return res.status(400).json({ 
          error: 'Invalid action',
          hint: 'Use: get, set (with value), up (with optional step), down (with optional step)'
        });
      }
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to control volume',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Prepare for rapid volume control (opens app and volume control screen)
  // Call this once when user starts controlling volume, then keep it open
  // Also starts keepalive to prevent screen timeout
  app.post('/api/android-mosaic/prepare', async (req: Request, res: Response) => {
    const relay = getAndroidMosaicRelay();
    if (!relay) {
      return res.status(503).json({ 
        error: 'Android Mosaic relay not initialized'
      });
    }

    try {
      // Open Mosaic ACTUS app
      const adbCmd = 'adb';
      const deviceFlag = (relay as any).config.emulatorSerial ? `-s ${(relay as any).config.emulatorSerial}` : '';
      const packageName = (relay as any).config.packageName;
      
      await execAsync(`${adbCmd} ${deviceFlag} shell am start -n ${packageName}/${packageName}.MainActivity`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Open volume control screen (tap volume display in bottom player bar)
      const volumeIconCoords = (relay as any).VOLUME_ICON_COORDS || { x: 972, y: 2121 };
      await execAsync(`${adbCmd} ${deviceFlag} shell input tap ${volumeIconCoords.x} ${volumeIconCoords.y}`);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Keepalive disabled - was triggering floating menu
      // (relay as any).startKeepAlive();
      
      res.json({ 
        success: true, 
        message: 'Mosaic ACTUS app and volume control ready for rapid volume changes. Keepalive started.' 
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to prepare volume control',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // Stop keepalive (when user stops controlling volume)
  app.post('/api/android-mosaic/stop', async (req: Request, res: Response) => {
    const relay = getAndroidMosaicRelay();
    if (!relay) {
      return res.status(503).json({ 
        error: 'Android Mosaic relay not initialized'
      });
    }

    try {
      (relay as any).stopKeepAlive();
      res.json({ 
        success: true, 
        message: 'Keepalive stopped' 
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to stop keepalive',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get device status
  app.get('/api/android-mosaic/status', async (req: Request, res: Response) => {
    const relay = getAndroidMosaicRelay();
    if (!relay) {
      return res.status(503).json({ 
        error: 'Android Mosaic relay not initialized'
      });
    }

    try {
      const adbCmd = 'adb';
      const { stdout } = await execAsync(`${adbCmd} devices`);
      const devices = stdout.split('\n')
        .filter(line => line.includes('\tdevice'))
        .map(line => line.split('\t')[0]);

      res.json({
        success: true,
        devices,
        packageName: (relay as any).config.packageName,
        currentVolume: await relay.getVolume(), // Returns percentage (0-100)
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get status',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
