/**
 * Chromecast Service using castv2-client
 * Replaces catt/dashcast with direct Chromecast communication
 */

const Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const mdns = require('mdns-js');

class ChromecastService {
  constructor() {
    this.client = null;
    this.device = null;
    this.mediaReceiver = null;
    this.isConnected = false;
    this.isCasting = false;
    this.currentUrl = null;
    this.chromecastIp = '';
    this.chromecastName = '';
    this.chromecastEnabled = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
  }

  /**
   * Configure Chromecast device
   */
  configure(ip, name, enabled) {
    this.chromecastIp = ip || '';
    this.chromecastName = name || '';
    this.chromecastEnabled = enabled !== undefined ? enabled : true;
    
    if (!this.chromecastEnabled && this.isConnected) {
      this.disconnect();
    }
    
    console.log(`[Chromecast] Configured: ${this.chromecastName || this.chromecastIp} (${this.chromecastIp}), enabled: ${this.chromecastEnabled}`);
  }

  /**
   * Connect to Chromecast device
   */
  async connect() {
    if (!this.chromecastIp) {
      console.log('[Chromecast] No IP configured');
      return false;
    }

    if (!this.chromecastEnabled) {
      console.log('[Chromecast] Disabled');
      return false;
    }

    if (this.isConnected) {
      console.log('[Chromecast] Already connected');
      return true;
    }

    return new Promise((resolve) => {
      console.log(`[Chromecast] Connecting to ${this.chromecastIp}...`);
      
      this.client = new Client();
      this.reconnectAttempts = 0;

      this.client.connect(this.chromecastIp, () => {
        console.log('[Chromecast] Connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Launch default media receiver
        // Note: For HTML web pages, we use DefaultMediaReceiver with appropriate content type
        this.client.launch(DefaultMediaReceiver, (err, player) => {
          if (err) {
            console.error('[Chromecast] Error launching media receiver:', err);
            this.isConnected = false;
            resolve(false);
            return;
          }
          
          this.mediaReceiver = player;
          console.log('[Chromecast] Media receiver launched');
          resolve(true);
        });
      });

      this.client.on('error', (err) => {
        console.error('[Chromecast] Connection error:', err.message);
        this.isConnected = false;
        this.mediaReceiver = null;
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`[Chromecast] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
          setTimeout(() => {
            if (this.chromecastEnabled && this.chromecastIp) {
              this.connect();
            }
          }, this.reconnectDelay);
        } else {
          console.error('[Chromecast] Max reconnect attempts reached');
        }
        resolve(false);
      });

      // Set connection timeout
      setTimeout(() => {
        if (!this.isConnected) {
          console.error('[Chromecast] Connection timeout');
          if (this.client) {
            this.client.close();
            this.client = null;
          }
          resolve(false);
        }
      }, 10000);
    });
  }

  /**
   * Disconnect from Chromecast
   */
  disconnect() {
    if (this.mediaReceiver) {
      try {
        this.mediaReceiver.stop();
      } catch (e) {
        // Ignore errors
      }
      this.mediaReceiver = null;
    }

    if (this.client) {
      try {
        this.client.close();
      } catch (e) {
        // Ignore errors
      }
      this.client = null;
    }

    this.isConnected = false;
    this.isCasting = false;
    this.currentUrl = null;
    console.log('[Chromecast] Disconnected');
  }

  /**
   * Cast a URL to Chromecast
   */
  async castUrl(url) {
    if (!this.chromecastEnabled || !this.chromecastIp) {
      console.log('[Chromecast] Not configured or disabled');
      return false;
    }

    if (this.isCasting && this.currentUrl === url) {
      console.log('[Chromecast] Already casting this URL');
      return true;
    }

    // Ensure we're connected
    if (!this.isConnected || !this.mediaReceiver) {
      const connected = await this.connect();
      if (!connected) {
        console.error('[Chromecast] Failed to connect');
        return false;
      }
    }

    return new Promise((resolve) => {
      console.log(`[Chromecast] Casting URL: ${url}`);
      
      // For HTML web pages, we need to use a content type that Chromecast can handle
      // Try using 'video/mp4' first, which works for some web content
      // If that fails, we'll try other approaches
      const media = {
        contentId: url,
        contentType: 'video/mp4',
        streamType: 'BUFFERED',
        metadata: {
          type: 0,
          metadataType: 0,
          title: 'Now Playing',
          images: []
        }
      };

      this.mediaReceiver.load(media, { autoplay: true }, (err, status) => {
        if (err) {
          // If video/mp4 fails, try with application/x-mpegurl (HLS)
          console.log('[Chromecast] First attempt failed, trying HLS format...');
          const media2 = {
            contentId: url,
            contentType: 'application/x-mpegurl',
            streamType: 'BUFFERED',
            metadata: {
              type: 0,
              metadataType: 0,
              title: 'Now Playing',
              images: []
            }
          };
          
          this.mediaReceiver.load(media2, { autoplay: true }, (err2, status2) => {
            if (err2) {
              console.error('[Chromecast] Error casting:', err2.message);
              this.isCasting = false;
              resolve(false);
              return;
            }
            
            console.log('[Chromecast] Cast started successfully with HLS format');
            this.isCasting = true;
            this.currentUrl = url;
            resolve(true);
          });
          return;
        }

        console.log('[Chromecast] Cast started successfully');
        this.isCasting = true;
        this.currentUrl = url;
        resolve(true);
      });
    });
  }

  /**
   * Stop casting
   */
  async stop() {
    if (!this.isCasting) {
      return true;
    }

    if (this.mediaReceiver) {
      return new Promise((resolve) => {
        this.mediaReceiver.stop((err) => {
          if (err) {
            console.error('[Chromecast] Error stopping cast:', err.message);
            resolve(false);
          } else {
            console.log('[Chromecast] Cast stopped');
            this.isCasting = false;
            this.currentUrl = null;
            resolve(true);
          }
        });
      });
    }

    this.isCasting = false;
    this.currentUrl = null;
    return true;
  }

  /**
   * Discover Chromecast devices on the network
   */
  static discoverDevices(timeout = 5000) {
    return new Promise((resolve) => {
      const devices = [];
      const browser = mdns.createBrowser(mdns.tcp('googlecast'));

      browser.on('ready', () => {
        console.log('[Chromecast] Starting device discovery...');
        browser.discover();
      });

      browser.on('update', (data) => {
        if (data && data.addresses && data.addresses.length > 0) {
          const ip = data.addresses[0];
          let name = data.fullname || data.name || '';
          
          // Clean up name
          if (name.includes('._googlecast')) {
            name = name.split('._googlecast')[0];
          }
          
          // Avoid duplicates
          if (!devices.find(d => d.ip === ip)) {
            devices.push({
              ip,
              name: name || `Chromecast (${ip})`,
              port: data.port || 8009
            });
            console.log(`[Chromecast] Found device: ${name || ip} (${ip})`);
          }
        }
      });

      setTimeout(() => {
        browser.stop();
        console.log(`[Chromecast] Discovery complete, found ${devices.length} device(s)`);
        resolve(devices);
      }, timeout);
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isCasting: this.isCasting,
      chromecastIp: this.chromecastIp,
      chromecastName: this.chromecastName,
      chromecastEnabled: this.chromecastEnabled,
      currentUrl: this.currentUrl
    };
  }
}

// Export singleton instance
const chromecastService = new ChromecastService();

module.exports = chromecastService;
module.exports.ChromecastService = ChromecastService;

