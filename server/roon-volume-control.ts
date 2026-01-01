/**
 * Roon Volume Control Service
 *
 * Provides programmatic volume control for Roon using the Roon API.
 * This service connects to Roon Core and allows fast volume adjustments
 * without UI popups or delays.
 */

import RoonApi from 'node-roon-api';
import RoonApiTransport from 'node-roon-api-transport';

interface RoonVolumeControlConfig {
  enabled: boolean;
}

interface RoonOutput {
  output_id: string;
  zone_id: string;
  display_name: string;
  volume?: {
    type: 'db' | 'number';
    min?: number;
    max?: number;
    step?: number;
    value?: number;
  };
}

class RoonVolumeControl {
  private config: RoonVolumeControlConfig;
  private roon: RoonApi | null = null;
  private transport: RoonApiTransport | null = null;
  private outputs: Map<string, RoonOutput> = new Map();
  private zones: Map<string, any> = new Map();
  private currentOutputId: string | null = null;
  private currentZoneId: string | null = null;
  private currentOutputName: string | null = null;
  private isConnected: boolean = false;
  private isReadyFlag: boolean = false;

  // Direct connection to Roon Core
  private roonCoreHost: string = process.env.ROON_CORE_IP || '192.168.0.19';
  private roonCorePort: number = parseInt(process.env.ROON_CORE_PORT || '9330');
  private extensionId: string;

  constructor(config: RoonVolumeControlConfig) {
    this.config = config;
    // Use a unique extension ID to force fresh registration
    this.extensionId = 'com.soundstream.roon.volume.v4';
  }

  /**
   * Initialize and establish persistent connection
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[RoonVolumeControl] Disabled in configuration');
      return;
    }

    console.log('[RoonVolumeControl] Initializing persistent connection...');
    console.log(`[RoonVolumeControl] Using extension ID: ${this.extensionId}`);

    // Create unique display name with timestamp to identify current extension
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Create RoonApi instance using the persistent extension ID
    this.roon = new RoonApi({
      extension_id: this.extensionId,
      display_name: `Soundstream Volume Control (${timestamp})`,
      display_version: '1.0.0',
      publisher: 'Soundstream',
      email: 'support@soundstream.app',
      log_level: 'all',
      core_paired: (core: any) => {
        console.log(`[RoonVolumeControl] ✅ PAIRED with Roon Core: ${core.display_name}`);
        console.log(`[RoonVolumeControl] Core ID: ${core.core_id}`);

        // Create transport service
        this.transport = new RoonApiTransport(this.roon);

        // Set moo connection
        const roonAny = this.roon as any;
        if (roonAny.paired_core && roonAny.paired_core.moo) {
          roonAny.moo = roonAny.paired_core.moo;
          console.log('[RoonVolumeControl] ✅ Moo connection established');
        }

        this.isConnected = true;
        console.log('[RoonVolumeControl] ✅ Marked as connected');

        // Get outputs
        this._refreshOutputs();
      },
      core_unpaired: (core: any) => {
        console.log(`[RoonVolumeControl] ❌ UNPAIRED from Roon Core: ${core?.display_name}`);
        this.isConnected = false;
        this.isReadyFlag = false;
        this.outputs.clear();
        this.currentOutputId = null;
        this.currentZoneId = null;
        this.currentOutputName = null;
      },
    });

    // Initialize services BEFORE connecting
    this.roon.init_services({
      required_services: [RoonApiTransport],
      optional_services: [],
      provided_services: [],
    });

    // Connect directly to specified Roon Core
    console.log(`[RoonVolumeControl] Connecting to ${this.roonCoreHost}:${this.roonCorePort}`);
    this.roon.ws_connect({
      host: this.roonCoreHost,
      port: this.roonCorePort,
      onclose: () => {
        console.log('[RoonVolumeControl] Connection closed');
        this.isConnected = false;
        this.isReadyFlag = false;
        // Attempt to reconnect after a delay
        console.log('[RoonVolumeControl] Scheduling reconnection in 5 seconds...');
        setTimeout(() => this._initializeConnection(), 5000);
      },
      onerror: (moo: any) => {
        console.error('[RoonVolumeControl] Connection error:', moo);
        this.isConnected = false;
        this.isReadyFlag = false;
        // Attempt to reconnect after a delay
        console.log('[RoonVolumeControl] Scheduling reconnection in 5 seconds...');
        setTimeout(() => this._initializeConnection(), 5000);
      }
    });
  }

  private _refreshOutputs(): void {
    if (!this.transport) {
      console.error('[RoonVolumeControl] No transport available for get_outputs');
      return;
    }

    console.log('[RoonVolumeControl] Getting outputs...');
    this.transport.get_outputs((err: any, outputs: any) => {
      console.log('[RoonVolumeControl] get_outputs callback called');
      if (err) {
        console.error('[RoonVolumeControl] Failed to get outputs:', err);
        return;
      }

      console.log(`[RoonVolumeControl] Got ${outputs?.outputs?.length || 0} outputs`);
      if (outputs && outputs.outputs) {
        // Clear existing outputs
        this.outputs.clear();

        // Store new outputs and log details
        for (const output of outputs.outputs) {
          console.log(`[RoonVolumeControl] Output: ${output.display_name}, id: ${output.output_id}, zone: ${output.zone_id}, has_volume: ${!!output.volume}`);
          if (output.volume) {
            console.log(`[RoonVolumeControl] Volume config: type=${output.volume.type}, min=${output.volume.min}, max=${output.volume.max}, value=${output.volume.value}`);
          }
          this.outputs.set(output.output_id, output);
        }

        // Auto-select first output with volume control
        const volumeOutput = outputs.outputs.find((o: any) => o.volume);
        if (volumeOutput) {
          this.currentOutputId = volumeOutput.output_id;
          this.currentZoneId = volumeOutput.zone_id;
          this.currentOutputName = volumeOutput.display_name;
          this.isReadyFlag = true;
          console.log(`[RoonVolumeControl] Selected output: ${volumeOutput.display_name} (${volumeOutput.output_id})`);
          console.log(`[RoonVolumeControl] Zone ID: ${volumeOutput.zone_id}`);
        } else {
          console.warn('[RoonVolumeControl] No outputs with volume control found');
          this.isReadyFlag = false;
        }
      } else {
        console.warn('[RoonVolumeControl] No outputs returned');
        this.isReadyFlag = false;
      }
    });

    // Also try to get zones to see what's available
    console.log('[RoonVolumeControl] Getting zones...');
    this.transport.get_zones((err: any, zones: any) => {
      console.log('[RoonVolumeControl] get_zones callback called');
      if (err) {
        console.error('[RoonVolumeControl] Failed to get zones:', err);
        return;
      }

      console.log(`[RoonVolumeControl] Got ${zones?.zones?.length || 0} zones`);
      if (zones && zones.zones) {
        // Clear existing zones
        this.zones.clear();

        // Store zones
        for (const zone of zones.zones) {
          console.log(`[RoonVolumeControl] Zone: ${zone.display_name}, id: ${zone.zone_id}, outputs: ${zone.outputs?.length || 0}`);
          this.zones.set(zone.zone_id, zone);
          if (zone.outputs) {
            for (const output of zone.outputs) {
              console.log(`[RoonVolumeControl]   - Output in zone: ${output.display_name}, id: ${output.output_id}`);
            }
          }
        }
      }
    });
  }

  /**
   * Get current volume (0-100)
   */
  async getVolume(): Promise<number> {
    console.log('[RoonVolumeControl] Getting current volume');

    if (!this.isReady()) {
      throw new Error('Roon volume control not ready');
    }

    if (!this.currentOutputId) {
      throw new Error('No output selected');
    }

    const output = this.outputs.get(this.currentOutputId);
    if (!output) {
      throw new Error(`Output not found: ${this.currentOutputId}`);
    }

    if (!output.volume) {
      throw new Error('Output does not support volume control');
    }

    const volumeValue = output.volume.value;
    if (volumeValue === undefined) {
      throw new Error('Volume value not available');
    }

    // Convert to 0-100 scale
    let percent: number;
    if (output.volume.type === 'db') {
      const min = output.volume.min || -80;
      const max = output.volume.max || 0;
      const range = max - min;
      percent = ((volumeValue - min) / range) * 100;
    } else {
      if (volumeValue <= 1) {
        percent = volumeValue * 100;
      } else {
        percent = volumeValue;
      }
    }

    const result = Math.max(0, Math.min(100, Math.round(percent)));
    console.log(`[RoonVolumeControl] Current volume: ${result}%`);
    return result;
  }

  /**
   * Set volume (0-100)
   */
  async setVolume(volume: number): Promise<void> {
    const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)));
    console.log(`[RoonVolumeControl] Setting volume to ${clampedVolume}%`);

    if (!this.isReady()) {
      throw new Error('Roon volume control not ready');
    }

    const output = this.outputs.get(this.currentOutputId!);
    if (!output || !output.volume) {
      throw new Error('Output does not support volume control');
    }

    // Convert volume to the output's native format
    let targetValue: number;
    const volumeConfig = output.volume;

    console.log(`[RoonVolumeControl] Volume config: type=${volumeConfig.type}, min=${volumeConfig.min}, max=${volumeConfig.max}, current=${volumeConfig.value}`);

    if (volumeConfig.type === 'db') {
      const min = volumeConfig.min || -80;
      const max = volumeConfig.max || 0;
      const range = max - min;
      targetValue = min + (clampedVolume / 100) * range;
      console.log(`[RoonVolumeControl] dB calculation: min=${min}, max=${max}, range=${range}, target=${targetValue}`);
    } else {
      if (volumeConfig.max && volumeConfig.max <= 1) {
        targetValue = clampedVolume / 100;
      } else {
        targetValue = clampedVolume;
      }
      console.log(`[RoonVolumeControl] Linear calculation: target=${targetValue}`);
    }

    console.log(`[RoonVolumeControl] Final target value: ${targetValue} (${clampedVolume}%)`);

    return new Promise((resolve, reject) => {
      // Try zone-based control first, fallback to output
      const zone = this.zones.get(this.currentZoneId!);

      if (zone) {
        console.log(`[RoonVolumeControl] Trying zone-based volume control first`);
        this.transport!.change_volume(
          { zone_id: zone.zone_id },
          'absolute',
          targetValue,
          (err: any) => {
            console.log(`[RoonVolumeControl] Zone change_volume callback with err:`, err);
            if (!err) {
              console.log(`[RoonVolumeControl] Volume set successfully via zone`);
              // Refresh outputs to get updated volume values
              setTimeout(() => this._refreshOutputs(), 500);
              resolve();
            } else {
              console.log(`[RoonVolumeControl] Zone failed, trying output...`);
              // Fallback to output-based control
              this.tryOutputVolumeControl(targetValue, resolve, reject);
            }
          }
        );
      } else {
        console.log(`[RoonVolumeControl] No zone found, using output-based control`);
        this.tryOutputVolumeControl(targetValue, resolve, reject);
      }
    });
  }

  private tryOutputVolumeControl(targetValue: number, resolve: () => void, reject: (error: Error) => void) {
    console.log(`[RoonVolumeControl] Using output-based absolute volume control`);

    this.transport!.change_volume(
      { output_id: this.currentOutputId },
      'absolute',
      targetValue,
      (err: any) => {
        console.log(`[RoonVolumeControl] Output change_volume callback called with err:`, err);
        if (err) {
          console.error('[RoonVolumeControl] Failed output volume control:', err);
          reject(new Error(`Failed to set volume: ${err}`));
        } else {
          console.log(`[RoonVolumeControl] Volume set successfully via output control`);
          // Refresh outputs to get updated volume values
          setTimeout(() => this._refreshOutputs(), 500);
          resolve();
        }
      }
    );
  }

  /**
   * Calculate volume percentage from output
   */
  private calculateVolumePercent(output: any): number {
    if (!output.volume) return 0;

    const volumeValue = output.volume.value;
    if (volumeValue === undefined) return 0;

    // Convert to 0-100 scale
    let percent: number;
    if (output.volume.type === 'db') {
      const min = output.volume.min || -80;
      const max = output.volume.max || 0;
      const range = max - min;
      percent = ((volumeValue - min) / range) * 100;
    } else {
      if (volumeValue <= 1) {
        percent = volumeValue * 100;
      } else {
        percent = volumeValue;
      }
    }

    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  /**
   * Volume up by step
   */
  async volumeUp(step: number = 2): Promise<number> {
    const current = await this.getVolume();
    const newVolume = Math.min(100, current + step);
    await this.setVolume(newVolume);
    return newVolume;
  }

  /**
   * Volume down by step
   */
  async volumeDown(step: number = 2): Promise<number> {
    const current = await this.getVolume();
    const newVolume = Math.max(0, current - step);
    await this.setVolume(newVolume);
    return newVolume;
  }

  /**
   * Check if ready
   */
  isReady(): boolean {
    const ready = this.isConnected && this.isReadyFlag;
    console.log(`[RoonVolumeControl] isReady() called: isConnected=${this.isConnected}, isReadyFlag=${this.isReadyFlag}, ready=${ready}`);
    return ready;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): { connected: boolean; outputCount: number; currentOutput: string | null; currentOutputName: string | null } {
    // Consider connected if we have a connection and outputs, or if we're in the process of connecting
    let connected = this.isConnected && this.outputs.size > 0;

    // Also check if we have a paired core (indicates authorization)
    const hasPairedCore = (this.roon as any).paired_core !== undefined;
    if (hasPairedCore && !connected) {
      console.log('[RoonVolumeControl] Found paired core, marking as connected');
      this.isConnected = true;
      connected = true;
      // Try to refresh outputs if we don't have them
      if (this.outputs.size === 0 && this.transport) {
        this._refreshOutputs();
      }
    }

    // Ensure isReadyFlag is set if we have outputs with volume control
    if (connected && !this.isReadyFlag) {
      // Check if we have any output with volume control
      const hasVolumeOutput = Array.from(this.outputs.values()).some(output => output.volume);
      if (hasVolumeOutput) {
        console.log('[RoonVolumeControl] Found volume-capable outputs, marking as ready');
        this.isReadyFlag = true;
        // Auto-select first output with volume control if not already selected
        if (!this.currentOutputId) {
          const volumeOutput = Array.from(this.outputs.values()).find(output => output.volume);
          if (volumeOutput) {
            this.currentOutputId = volumeOutput.output_id;
            this.currentZoneId = volumeOutput.zone_id;
            this.currentOutputName = volumeOutput.display_name;
            console.log(`[RoonVolumeControl] Auto-selected output: ${volumeOutput.display_name} (${volumeOutput.output_id})`);
          }
        }
      }
    }

    console.log(`[RoonVolumeControl] getConnectionStatus: isConnected=${this.isConnected}, outputs.size=${this.outputs.size}, isReadyFlag=${this.isReadyFlag}, hasPairedCore=${hasPairedCore}, connected=${connected}`);
    return {
      connected,
      outputCount: this.outputs.size,
      currentOutput: this.currentOutputId,
      currentOutputName: this.currentOutputName,
    };
  }

  /**
   * Get available outputs
   */
  getOutputs(): Map<string, any> {
    console.log(`[RoonVolumeControl] getOutputs() called, returning ${this.outputs.size} outputs`);
    console.log(`[RoonVolumeControl] outputs keys:`, Array.from(this.outputs.keys()));
    console.log(`[RoonVolumeControl] outputs values:`, Array.from(this.outputs.values()).map(o => ({ id: o.output_id, name: o.display_name })));
    return this.outputs;
  }

  /**
   * Get available zones
   */
  getZones(): Map<string, any> {
    return this.zones;
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.roon) {
      this.roon.disconnect_all();
      this.roon = null;
    }
    this.transport = null;
    this.outputs.clear();
    this.currentOutputId = null;
    this.currentZoneId = null;
    this.currentOutputName = null;
    this.isConnected = false;
    this.isReadyFlag = false;
    console.log('[RoonVolumeControl] Shutdown complete');
  }
}

// Singleton instance
let roonVolumeControlInstance: RoonVolumeControl | null = null;

/**
 * Initialize Roon volume control
 */
export function initializeRoonVolumeControl(config: RoonVolumeControlConfig): RoonVolumeControl {
  if (roonVolumeControlInstance) {
    console.warn('[RoonVolumeControl] Already initialized, reinitializing...');
    roonVolumeControlInstance.shutdown();
  }

  roonVolumeControlInstance = new RoonVolumeControl(config);
  return roonVolumeControlInstance;
}

/**
 * Initialize + start the Roon volume control service.
 * (Calling initializeRoonVolumeControl alone only constructs the instance.)
 */
export async function startRoonVolumeControl(config: RoonVolumeControlConfig): Promise<RoonVolumeControl> {
  const instance = initializeRoonVolumeControl(config);
  try {
    await instance.initialize();
  } catch (e) {
    console.error('[RoonVolumeControl] Failed to start:', e instanceof Error ? e.message : String(e));
  }
  return instance;
}

/**
 * Get the Roon volume control instance
 */
export function getRoonVolumeControl(): RoonVolumeControl | null {
  return roonVolumeControlInstance;
}