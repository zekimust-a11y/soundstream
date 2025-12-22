declare module 'node-roon-api-transport' {
  import RoonApi from 'node-roon-api';

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

  interface OutputsResponse {
    outputs?: RoonOutput[];
  }

  interface ChangeVolumeOptions {
    output_id: string;
    how: 'absolute' | 'relative' | 'relative_step';
    value?: number;
    step?: number;
  }

  type OutputsCallback = (cmd: string, data: OutputsResponse) => void;
  type GetOutputsCallback = (err: any, outputs: OutputsResponse | null) => void;
  type ChangeVolumeCallback = (err: any) => void;

  class RoonApiTransport {
    constructor(roon: RoonApi | null);
    subscribe_outputs(callback: OutputsCallback): void;
    get_outputs(callback: GetOutputsCallback): void;
    change_volume(options: ChangeVolumeOptions, callback: ChangeVolumeCallback): void;
  }

  export default RoonApiTransport;
}




