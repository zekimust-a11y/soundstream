const EventEmitter = require('events');
const { Client } = require('castv2');
const mdns = require('mdns-js');

// Custom Cast App ID from user's Google Cast Developer Console
const CUSTOM_APP_ID = '180705D2';
const CUSTOM_NAMESPACE = 'urn:x-cast:com.google.cast.media';
const RECEIVER_URL = 'https://zekimust-a11y.github.io/lms-cast/';

/**
 * Chromecast Service using castv2 with custom receiver app
 * Ported from roon-cast, adapted for LMS data
 */
class ChromecastService extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    
    this.chromecastIp = '';
    this.chromecastName = '';
    this.chromecastEnabled = false;
    
    this.client = null;
    this.connectionChannel = null;
    this.receiverChannel = null;
    this.appConnection = null;
    this.customChannel = null;
    this.heartbeat = null;
    this.heartbeatInterval = null;
    this.transportId = null;
    this.castStatus = 'idle';
    
    this.pendingLaunch = null;
    this.requestId = 1;
    this.isCasting = false;
    this.currentUrl = null;
  }

  configure(ip, name, enabled) {
    this.chromecastIp = ip || '';
    this.chromecastName = name || '';
    this.chromecastEnabled = enabled;
    console.log(`[ChromecastService] Configured: ${this.chromecastName || this.chromecastIp} (${this.chromecastIp}), Enabled: ${this.chromecastEnabled}`);
    
    if (!this.chromecastEnabled && this.isCasting) {
      this.stop();
    }
  }

  resetApplicationState() {
    this.transportId = null;
    this.customChannel = null;
    if (this.appConnection) {
      try {
        this.appConnection.close?.();
      } catch (err) {
        // ignore
      }
    }
    this.appConnection = null;
  }

  async connect() {
    if (!this.chromecastIp) {
      throw new Error('No Chromecast IP configured');
    }

    if (this.client && this.connectionChannel && this.receiverChannel) {
      console.log('[Chromecast] reuse existing client connection');
      return;
    }

    return new Promise((resolve, reject) => {
      console.log(`[Chromecast] TCP connecting to ${this.chromecastIp}...`);
      
      this.client = new Client();
      
      this.client.connect(this.chromecastIp, () => {
        console.log('[Chromecast] TCP connected');
        
        this.connectionChannel = this.client.createChannel(
          'sender-0',
          'receiver-0',
          'urn:x-cast:com.google.cast.tp.connection',
          'JSON'
        );
        
        this.receiverChannel = this.client.createChannel(
          'sender-0',
          'receiver-0',
          'urn:x-cast:com.google.cast.receiver',
          'JSON'
        );
        
        this.connectionChannel.send({ type: 'CONNECT' });
        this.receiverChannel.send({ type: 'GET_STATUS', requestId: this.requestId++ });
        
        this.receiverChannel.on('message', (data) => {
          this.handleReceiverMessage(data);
        });
        
        // Start heartbeat
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
        }
        this.heartbeatInterval = setInterval(() => {
          if (this.connectionChannel) {
            try {
              this.connectionChannel.send({ type: 'PING' });
            } catch (e) {
              console.error('[Chromecast] Heartbeat error:', e.message);
            }
          }
        }, 5000);
        
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('[Chromecast] Client error:', err.message);
        this.disconnect();
        reject(err);
      });

      this.client.on('close', () => {
        console.log('[Chromecast] Connection closed');
        this.disconnect();
      });
    });
  }

  handleReceiverMessage(message) {
    if (!message || !message.type) return;
    
    if (message.type === 'RECEIVER_STATUS') {
      this.processReceiverStatus(message.status);
    } else if (message.type === 'LAUNCH_ERROR') {
      console.error('[Chromecast] Launch error:', message);
      if (this.pendingLaunch && this.pendingLaunch.reject) {
        this.pendingLaunch.reject(new Error(message.reason || 'Launch failed'));
        this.pendingLaunch = null;
      }
    }
  }

  processReceiverStatus(status) {
    if (!status || !status.applications) {
      this.resetApplicationState();
      return;
    }
    
    const app = status.applications.find((entry) => entry.appId === CUSTOM_APP_ID);
    if (!app) {
      this.resetApplicationState();
      if (this.pendingLaunch && this.pendingLaunch.reject) {
        this.pendingLaunch.reject(new Error('App not running'));
        this.pendingLaunch = null;
      }
      return;
    }

    if (app.transportId !== this.transportId) {
      this.transportId = app.transportId;
      this.bindApplicationChannels();
    }

    if (this.pendingLaunch && this.transportId) {
      clearTimeout(this.pendingLaunch.timer);
      if (this.pendingLaunch.resolve) {
        this.pendingLaunch.resolve();
      }
      this.pendingLaunch = null;
    }
  }

  bindApplicationChannels() {
    console.log(`[Chromecast] binding app channels for transport ${this.transportId}`);
    
    this.appConnection = this.client.createChannel(
      'sender-0',
      this.transportId,
      'urn:x-cast:com.google.cast.tp.connection',
      'JSON'
    );
    
    this.customChannel = this.client.createChannel(
      'sender-0',
      this.transportId,
      CUSTOM_NAMESPACE,
      'JSON'
    );
    
    this.appConnection.send({ type: 'CONNECT' });
    
    // Listen for messages from the receiver
    this.customChannel.on('message', (data) => {
      console.log('[Chromecast] Receiver message:', data);
    });
    
    console.log('[Chromecast] app channels bound');
  }

  async ensureLaunched() {
    await this.connect();
    if (this.transportId && this.customChannel) return;
    if (!this.receiverChannel) throw new Error('Receiver channel not established');

    if (this.pendingLaunch) return this.pendingLaunch.promise;

    this.pendingLaunch = {};
    this.pendingLaunch.promise = new Promise((resolve, reject) => {
      this.pendingLaunch.resolve = resolve;
      this.pendingLaunch.reject = reject;
      
      console.log(`[Chromecast] Launching custom app ${CUSTOM_APP_ID} with URL ${RECEIVER_URL}...`);
      this.receiverChannel.send({
        type: 'LAUNCH',
        appId: CUSTOM_APP_ID,
        requestId: this.requestId++,
      });
      
      this.pendingLaunch.timer = setTimeout(() => {
        if (this.pendingLaunch && this.pendingLaunch.reject) {
          this.pendingLaunch.reject(new Error('Chromecast launch timeout'));
          this.pendingLaunch = null;
        }
      }, 10000);
    });

    return this.pendingLaunch.promise;
  }

  async castUrl(url) {
    if (!this.chromecastEnabled || !this.chromecastIp) {
      console.log('[Chromecast] Not configured or disabled');
      return false;
    }

    if (this.isCasting && this.currentUrl === url) {
      console.log('[Chromecast] Already casting this URL');
      return true;
    }

    try {
      await this.ensureLaunched();
      
      if (!this.customChannel) {
        throw new Error('Custom channel unavailable');
      }

      console.log(`[Chromecast] Casting URL: ${url}`);
      
      // Extract LMS parameters from the URL
      const urlObj = new URL(url);
      const lmsHost = urlObj.searchParams.get('host');
      const lmsPort = urlObj.searchParams.get('port') || '9000';
      const lmsPlayer = urlObj.searchParams.get('player');
      
      // Send LMS parameters to the custom receiver via Cast message
      console.log(`[Chromecast] Sending LMS params: host=${lmsHost}, port=${lmsPort}, player=${lmsPlayer}`);
      this.customChannel.send({
        type: 'SET_LMS_PARAMS',
        host: lmsHost,
        port: lmsPort,
        player: lmsPlayer
      });

      this.isCasting = true;
      this.currentUrl = url;
      console.log('[Chromecast] Cast started successfully');
      return true;
    } catch (error) {
      console.error('[Chromecast] Error casting:', error.message);
      this.isCasting = false;
      return false;
    }
  }

  async stop() {
    if (!this.isCasting) {
      return true;
    }

    console.log('[Chromecast] Stopping cast...');
    
    try {
      // Send STOP message to receiver
      if (this.receiverChannel) {
        this.receiverChannel.send({
          type: 'STOP',
          requestId: this.requestId++,
        });
      }
    } catch (e) {
      console.error('[Chromecast] Error stopping:', e.message);
    }
    
    this.disconnect();
    this.isCasting = false;
    this.currentUrl = null;
    return true;
  }

  disconnect() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.resetApplicationState();
    
    if (this.connectionChannel) {
      try {
        this.connectionChannel.send({ type: 'CLOSE' });
      } catch (e) {
        // ignore
      }
      this.connectionChannel = null;
    }
    
    this.receiverChannel = null;
    
    if (this.client) {
      try {
        this.client.close();
      } catch (e) {
        // ignore
      }
      this.client = null;
    }
    
    console.log('[Chromecast] Disconnected');
  }

  getStatus() {
    return {
      chromecastIp: this.chromecastIp,
      chromecastName: this.chromecastName,
      chromecastEnabled: this.chromecastEnabled,
      isCasting: this.isCasting,
      currentUrl: this.currentUrl,
    };
  }

  static async discoverDevices(timeout = 5000) {
    return new Promise((resolve) => {
      console.log('[Chromecast] Discovering devices with mdns...');
      
      const devices = [];
      const discovered = new Set();

      try {
        const browser = mdns.createBrowser(mdns.tcp('googlecast'));

        browser.on('ready', () => {
          browser.discover();
        });

        browser.on('update', (service) => {
          const name = service.txt ? service.txt.find(t => t.startsWith('fn='))?.substring(3) : service.fullname;
          const ip = service.addresses && service.addresses.length > 0 ? service.addresses[0] : service.host;
          const id = `${ip}:${service.port}`;

          if (ip && !discovered.has(id)) {
            discovered.add(id);
            devices.push({
              name: name || service.fullname || 'Chromecast',
              ip: ip,
              port: service.port || 8009,
              friendlyName: name || 'Chromecast',
              manufacturer: 'Google',
              modelName: 'Chromecast'
            });
            console.log(`[Chromecast] Found device: ${name} at ${ip}`);
          }
        });

        setTimeout(() => {
          browser.stop();
          console.log(`[Chromecast] Discovery complete. Found ${devices.length} devices`);
          resolve(devices);
        }, timeout);
      } catch (e) {
        console.error('[Chromecast] Discovery error:', e.message);
        resolve(devices);
      }
    });
  }
}

module.exports = new ChromecastService();
module.exports.ChromecastService = ChromecastService;
