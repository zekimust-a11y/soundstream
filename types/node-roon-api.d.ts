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

  interface RoonService {
    // Base interface for Roon services
  }

  interface InitServicesOptions {
    required_services: RoonService[];
    optional_services?: RoonService[];
    provided_services: RoonService[];
    [key: string]: any; // Allow additional properties
  }

  class RoonApi {
    constructor(options: RoonApiOptions);
    init_services(options: InitServicesOptions): void;
    start_discovery(): void;
    stop(): void;
  }

  export default RoonApi;
}

