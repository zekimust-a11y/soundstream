import { Platform } from 'react-native';

/**
 * Get the API base URL for server requests
 */
function getApiUrl(): string {
  // Try to get the domain from environment variable
  let domain = process.env.EXPO_PUBLIC_DOMAIN;
  
  // If not set and we're on native, try to get from Expo dev server
  if (!domain && Platform.OS !== 'web') {
    try {
      // Try to use Constants from expo-constants if available
      const Constants = require('expo-constants').default;
      if (Constants?.expoConfig?.extra?.serverUrl) {
        domain = Constants.expoConfig.extra.serverUrl.replace(/^https?:\/\//, '');
      } else if (Constants?.manifest?.extra?.serverUrl) {
        domain = Constants.manifest.extra.serverUrl.replace(/^https?:\/\//, '');
      }
    } catch (e) {
      // expo-constants not available, continue with fallback
    }
  }
  
  // Fallback to localhost:3000 (won't work on native, but will log the error)
  if (!domain) {
    domain = 'localhost:3000';
  }
  
  const protocol = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.protocol : 'http:';
  return `${protocol}//${domain}`;
}

/**
 * Extract dominant color from an image URL
 * Returns a color in hex format, or a default color if extraction fails
 */
export async function extractDominantColor(imageUrl: string | undefined): Promise<string> {
  if (!imageUrl || imageUrl === '') {
    console.log('[ColorExtractor] No image URL provided, using default');
    return '#1C1C1E'; // Default dark color
  }

  try {
    // For web platform, we can use canvas to extract colors
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      return await extractColorFromImageWeb(imageUrl);
    }
    
    // For native platforms, use the server endpoint
    // If server is unreachable, fall back to hash-based color extraction
    try {
      const apiUrl = getApiUrl();
      console.log('[ColorExtractor] Native platform - attempting to extract color via server:', apiUrl);
      const fullUrl = `${apiUrl}/api/color/extract?url=${encodeURIComponent(imageUrl)}`;
      
      // Use a timeout to avoid hanging on unreachable servers
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      try {
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          if (data.color) {
            console.log('[ColorExtractor] Got color from server:', data.color);
            return data.color;
          }
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        // Silently fall through to hash-based extraction
        // Don't log network errors as they're expected when server is unreachable
      }
    } catch (serverError) {
      // Silently fall through to hash-based extraction
    }
    
    // Fallback: For native platforms, extract a color from the image URL hash
    // This gives us a consistent color based on the image URL even if server is unreachable
    console.log('[ColorExtractor] Using hash-based color extraction (server unreachable or unavailable)');
    try {
      // Create a simple hash from the image URL to generate a consistent color
      let hash = 0;
      for (let i = 0; i < imageUrl.length; i++) {
        hash = imageUrl.charCodeAt(i) + ((hash << 5) - hash);
      }
      // Generate RGB values from hash (darker colors for better text contrast)
      // Use a range that produces nice, visible colors (60-180 for good contrast)
      const r = Math.abs((hash & 0xFF0000) >> 16) % 120 + 60; // 60-180 range
      const g = Math.abs((hash & 0x00FF00) >> 8) % 120 + 60;
      const b = Math.abs(hash & 0x0000FF) % 120 + 60;
      const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      console.log('[ColorExtractor] Generated color from hash:', color);
      return color;
    } catch (e) {
      console.error('[ColorExtractor] Hash generation failed:', e);
      return '#2C2C2E'; // Fallback to darker grey
    }
  } catch (error) {
    console.error('[ColorExtractor] Failed to extract color from image:', error);
    return '#2C2C2E';
  }
}

async function extractColorFromImageWeb(imageUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    
    // Try to set crossOrigin, but handle cases where it might fail
    try {
      img.crossOrigin = 'anonymous';
    } catch (e) {
      // Some browsers may not support crossOrigin
      console.warn('Could not set crossOrigin:', e);
    }
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        // Scale down for faster processing while maintaining quality
        const scaleFactor = 0.3;
        canvas.width = Math.floor(img.width * scaleFactor);
        canvas.height = Math.floor(img.height * scaleFactor);
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve('#6B6B70'); // Default medium gray (readable)
          return;
        }
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Sample pixels from a larger central region to get the main color
        const sampleSize = 5;
        const startX = Math.floor(canvas.width * 0.2);
        const startY = Math.floor(canvas.height * 0.2);
        const endX = Math.floor(canvas.width * 0.8);
        const endY = Math.floor(canvas.height * 0.8);
        
        const colorCounts: { [key: string]: { count: number; r: number; g: number; b: number } } = {};
        let maxCount = 0;
        let dominantColor = '#6B6B70';
        
        // Collect all colors with their frequencies
        for (let y = startY; y < endY; y += sampleSize) {
          for (let x = startX; x < endX; x += sampleSize) {
            const pixelData = ctx.getImageData(x, y, 1, 1).data;
            const r = pixelData[0];
            const g = pixelData[1];
            const b = pixelData[2];
            
            // Calculate brightness (0-255)
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114); // Perceptual brightness
            
            // Skip very dark pixels (too dark for readable text) and pure white/black
            if (brightness < 50 || brightness > 245) {
              continue;
            }
            
            // Quantize colors to group similar colors (less aggressive quantization for better color accuracy)
            const quantizedR = Math.floor(r / 16) * 16;
            const quantizedG = Math.floor(g / 16) * 16;
            const quantizedB = Math.floor(b / 16) * 16;
            
            const colorKey = `${quantizedR},${quantizedG},${quantizedB}`;
            
            if (!colorCounts[colorKey]) {
              colorCounts[colorKey] = { count: 0, r: quantizedR, g: quantizedG, b: quantizedB };
            }
            colorCounts[colorKey].count++;
            
            if (colorCounts[colorKey].count > maxCount) {
              maxCount = colorCounts[colorKey].count;
              const color = colorCounts[colorKey];
              dominantColor = `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;
            }
          }
        }
        
        // If no colors were found (all pixels were too dark/light), use a fallback
        if (maxCount === 0) {
          dominantColor = '#6B6B70';
        }
        
        // If we found a color, ensure it's not too dark
        const finalColor = ensureMinimumBrightness(dominantColor, 80); // Minimum brightness of 80 for readability
        resolve(finalColor);
      } catch (error) {
        console.error('Error extracting color:', error);
        // Fallback to server endpoint if canvas extraction fails
        const apiUrl = getApiUrl();
        fetch(`${apiUrl}/api/color/extract?url=${encodeURIComponent(imageUrl)}`)
          .then(response => {
            if (response.ok) {
              return response.json();
            }
            throw new Error('Server endpoint failed');
          })
          .then(data => {
            if (data.color) {
              console.log('[ColorExtractor] Got color from server (fallback):', data.color);
              resolve(data.color);
            } else {
              resolve('#6B6B70');
            }
          })
          .catch((err) => {
            console.error('[ColorExtractor] Server endpoint failed (fallback):', err);
            resolve('#6B6B70');
          });
      }
    };
    
    img.onerror = () => {
      console.warn('[ColorExtractor] Image load failed (likely CORS), trying server endpoint:', imageUrl);
      // If image fails to load (CORS issue), try using the server endpoint
      const apiUrl = getApiUrl();
      fetch(`${apiUrl}/api/color/extract?url=${encodeURIComponent(imageUrl)}`)
        .then(response => {
          if (response.ok) {
            return response.json();
          }
          throw new Error('Server endpoint failed');
        })
        .then(data => {
          if (data.color) {
            console.log('[ColorExtractor] Got color from server:', data.color);
            resolve(data.color);
          } else {
            resolve('#6B6B70');
          }
        })
        .catch((error) => {
          console.error('[ColorExtractor] Server endpoint failed:', error);
          resolve('#6B6B70');
        });
    };
    
    img.src = imageUrl;
  });
}

/**
 * Ensure a color has minimum brightness for text readability
 */
function ensureMinimumBrightness(hex: string, minBrightness: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  
  // Calculate perceptual brightness
  const brightness = r * 0.299 + g * 0.587 + b * 0.114;
  
  // If too dark, lighten it while preserving the color hue
  if (brightness < minBrightness) {
    const factor = minBrightness / brightness;
    const newR = Math.min(255, Math.floor(r * factor));
    const newG = Math.min(255, Math.floor(g * factor));
    const newB = Math.min(255, Math.floor(b * factor));
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }
  
  return hex;
}

/**
 * Lighten a color by a percentage, ensuring minimum brightness
 */
export function lightenColor(color: string, percent: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  
  // Lighten by blending with white
  const newR = Math.min(255, Math.floor(r + (255 - r) * percent));
  const newG = Math.min(255, Math.floor(g + (255 - g) * percent));
  const newB = Math.min(255, Math.floor(b + (255 - b) * percent));
  
  const lightened = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  
  // Ensure minimum brightness for text readability (at least 180 for light colors)
  return ensureMinimumBrightness(lightened, 180);
}

/**
 * Darken a color by a percentage
 * @param skipMinimumBrightness - If true, skip the minimum brightness check (useful for background colors)
 */
export function darkenColor(color: string, percent: number, skipMinimumBrightness: boolean = false): string {
  const num = parseInt(color.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  
  // Darken by reducing brightness
  const newR = Math.max(0, Math.floor(r * (1 - percent)));
  const newG = Math.max(0, Math.floor(g * (1 - percent)));
  const newB = Math.max(0, Math.floor(b * (1 - percent)));
  
  const darkened = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  
  // For background colors, we want them darker, so skip minimum brightness check
  if (skipMinimumBrightness) {
    return darkened;
  }
  
  // Ensure minimum brightness for text readability (at least 100 for dark colors)
  return ensureMinimumBrightness(darkened, 100);
}

