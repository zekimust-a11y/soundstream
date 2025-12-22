declare module 'node-roon-api-status' {
  import RoonApi from 'node-roon-api';

  type StatusValue = 'Network' | 'Connected' | 'Disconnected' | string;

  type StatusCallback = (cmd: string, data: StatusValue) => void;

  class RoonApiStatus {
    constructor(roon: RoonApi | null);
    subscribe(callback: StatusCallback): void;
  }

  export default RoonApiStatus;
}




