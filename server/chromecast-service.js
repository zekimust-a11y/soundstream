const { exec } = require('child_process');

// Full path to catt binary
const CATT_PATH = '/Users/zeki/Library/Python/3.9/bin/catt';

/**
 * Chromecast Service using catt for HTML casting
 * 
 * This service uses the 'catt' command-line tool to cast HTML pages to Chromecast.
 * Unlike castv2-client which is limited to media files, catt can cast arbitrary web content.
 */
class ChromecastService {
  constructor() {
    this.isCasting = false;
    this.currentUrl = null;
    this.chromecastIp = '';
    this.chromecastName = '';
    this.chromecastEnabled = false;
  }

  /**
   * Configure Chromecast settings
   */
  configure(ip, name, enabled) {
    this.chromecastIp = ip || '';
    this.chromecastName = name || '';
    this.chromecastEnabled = enabled;
    console.log(`[ChromecastService] Configured: ${this.chromecastName || this.chromecastIp} (${this.chromecastIp}), Enabled: ${this.chromecastEnabled}`);
    
    if (!this.chromecastEnabled && this.isCasting) {
      this.stop();
    }
  }

  /**
   * Cast a URL to Chromecast using catt
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

    return new Promise((resolve) => {
      console.log(`[Chromecast] Casting HTML page using catt: ${url}`);
      
      // Use catt to cast the HTML page
      // catt is specifically designed to cast web content to Chromecast
      const cattCmd = `${CATT_PATH} -d "${this.chromecastIp}" cast_site "${url}"`;
      
      exec(cattCmd, (error, stdout, stderr) => {
        if (error) {
          console.error('[Chromecast] catt error:', error.message);
          if (stderr) console.error('[Chromecast] stderr:', stderr.trim());
          this.isCasting = false;
          resolve(false);
          return;
        }

        console.log('[Chromecast] Cast started successfully with catt');
        if (stdout) console.log('[Chromecast] catt output:', stdout.trim());
        this.isCasting = true;
        this.currentUrl = url;
        resolve(true);
      });
    });
  }

  /**
   * Stop casting using catt
   */
  async stop() {
    if (!this.isCasting) {
      return true;
    }

    return new Promise((resolve) => {
      console.log('[Chromecast] Stopping cast with catt...');
      
      const cattCmd = `${CATT_PATH} -d "${this.chromecastIp}" stop`;
      
      exec(cattCmd, (error, stdout, stderr) => {
        if (error) {
          console.error('[Chromecast] catt stop error:', error.message);
          // Still mark as not casting even if stop fails
        }
        
        console.log('[Chromecast] Cast stopped');
        this.isCasting = false;
        this.currentUrl = null;
        resolve(true);
      });
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      chromecastIp: this.chromecastIp,
      chromecastName: this.chromecastName,
      chromecastEnabled: this.chromecastEnabled,
      isCasting: this.isCasting,
      currentUrl: this.currentUrl,
    };
  }

  /**
   * Discover Chromecast devices using catt
   */
  static async discoverDevices(timeout = 5000) {
    return new Promise((resolve) => {
      console.log('[Chromecast] Discovering devices with catt...');
      
      const cattCmd = `${CATT_PATH} scan -j`; // JSON output
      const devices = [];
      
      exec(cattCmd, { timeout }, (error, stdout, stderr) => {
        if (error) {
          console.error('[Chromecast] Discovery error:', error.message);
          resolve(devices);
          return;
        }

        try {
          // Parse JSON output from catt
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            try {
              const device = JSON.parse(line);
              if (device.ip && device.name) {
                devices.push({
                  name: device.name,
                  ip: device.ip,
                  friendlyName: device.friendly_name || device.name,
                  manufacturer: device.manufacturer || 'Google',
                  modelName: device.model_name || 'Chromecast'
                });
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
          
          console.log(`[Chromecast] Found ${devices.length} devices`);
          resolve(devices);
        } catch (e) {
          console.error('[Chromecast] Failed to parse discovery results:', e.message);
          resolve(devices);
        }
      });
    });
  }
}

module.exports = new ChromecastService();
module.exports.ChromecastService = ChromecastService;
