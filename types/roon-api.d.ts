/**
 * Type declarations for Roon API packages
 * These packages don't have official TypeScript definitions
 */

declare module 'node-roon-api' {
  interface RoonApiOptions {
    extension_id: string;
    display_name: string;
    display_version?: string;
    publisher?: string;
    email?: string;
    log_level?: 'none' | 'error' | 'warn' | 'info' | 'debug';
    core_paired?: (core: any) => void;
    core_unpaired?: (core: any) => void;
  }

  interface RoonApiServices {
    required_services?: any[];
    optional_services?: any[];
    provided_services?: any[];
  }

  class RoonApi {
    constructor(options: RoonApiOptions);
    init_services(services: RoonApiServices): void;
    start_discovery(): void;
    stop(): void;
  }

  export = RoonApi;
}

declare module 'node-roon-api-transport' {
  interface RoonOutput {
    output_id: string;
    zone_id: string;
    display_name: string;
    state?: 'playing' | 'paused' | 'loading' | 'stopped';
    volume?: {
      type: 'db' | 'number' | 'incremental';
      min?: number;
      max?: number;
      step?: number;
      value?: number;
      is_muted?: boolean;
    };
    source_controls?: {
      display_name: string;
      status: 'selected' | 'deselected' | 'standby' | 'indeterminate';
      supports_standby?: boolean;
    };
  }

  interface RoonZone {
    zone_id: string;
    display_name: string;
    outputs: RoonOutput[];
    state?: 'playing' | 'paused' | 'loading' | 'stopped';
    seek_position?: number;
    is_previous_allowed?: boolean;
    is_next_allowed?: boolean;
    is_pause_allowed?: boolean;
    is_play_allowed?: boolean;
    is_seek_allowed?: boolean;
    queue_items_remaining?: number;
    queue_time_remaining?: number;
    settings?: {
      loop?: 'loop' | 'loop_one' | 'disabled';
      shuffle?: boolean;
      auto_radio?: boolean;
    };
    now_playing?: any;
  }

  interface ChangeVolumeOptions {
    output_id?: string;
    zone_id?: string;
    how: 'absolute' | 'relative';
    value?: number;
    step?: number;
  }

  interface GetOutputsResult {
    outputs: RoonOutput[];
  }

  type OutputsCallback = (cmd: string, data: { outputs?: RoonOutput[] }) => void;
  type ResultCallback = (err: any, result?: any) => void;

  class RoonApiTransport {
    constructor(core: any);
    subscribe_outputs(callback: OutputsCallback): void;
    get_outputs(callback: ResultCallback): void;
    change_volume(options: ChangeVolumeOptions, callback: ResultCallback): void;
    mute_all(how: 'mute' | 'unmute', callback?: ResultCallback): void;
    mute(options: { output_id?: string; zone_id?: string; how: 'mute' | 'unmute' }, callback?: ResultCallback): void;
    pause_all(callback?: ResultCallback): void;
    play(options: { output_id?: string; zone_id?: string }, callback?: ResultCallback): void;
    pause(options: { output_id?: string; zone_id?: string }, callback?: ResultCallback): void;
    stop(options: { output_id?: string; zone_id?: string }, callback?: ResultCallback): void;
    previous(options: { output_id?: string; zone_id?: string }, callback?: ResultCallback): void;
    next(options: { output_id?: string; zone_id?: string }, callback?: ResultCallback): void;
    seek(options: { output_id?: string; zone_id?: string; how: 'absolute' | 'relative'; value: number }, callback?: ResultCallback): void;
    control(options: { output_id?: string; zone_id?: string; control_key: string }, callback?: ResultCallback): void;
  }

  export = RoonApiTransport;
}

declare module 'node-roon-api-status' {
  type StatusCallback = (cmd: string, data: any) => void;

  class RoonApiStatus {
    constructor(core: any);
    subscribe(callback: StatusCallback): void;
    set_status(message: string | null, is_error: boolean): void;
  }

  export = RoonApiStatus;
}

