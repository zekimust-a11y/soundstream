import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, ImageSourcePropType, PixelRatio } from "react-native";
import { Image } from "expo-image";
import { getApiUrl } from "@/lib/query-client";

const PLACEHOLDER_IMAGE = require("../assets/images/placeholder-album.png");

interface AlbumArtworkProps {
  source?: string | ImageSourcePropType;
  style?: any;
  contentFit?: "cover" | "contain" | "fill" | "none" | "scaleDown";
  placeholderColor?: string;
}

/**
 * AlbumArtwork component that displays album artwork or a dark grey placeholder
 * when artwork is missing. The placeholder matches the same shape/size as normal artwork.
 */
export function AlbumArtwork({ 
  source, 
  style, 
  contentFit = "cover",
  placeholderColor = "#3A3A3C" // Dark grey color (slightly lighter for better visibility)
}: AlbumArtworkProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState<0 | 1>(0);

  // Reset failure state when source changes
  useEffect(() => {
    setFailed(false);
    setAttempt(0);
  }, [source]);

  // Check if source is valid (not empty string, null, or undefined)
  // Also check if it's a valid URI (not just whitespace or placeholder text)
  const hasArtwork = source && 
    (typeof source === 'string' 
      ? source.trim().length > 0 && 
        !source.includes('placeholder') && 
        !source.includes('undefined') &&
        !source.includes('null')
      : true);

  const mergedStyle = useMemo(() => {
    if (!style) return [styles.placeholder, { backgroundColor: placeholderColor, width: 100, height: 100 }];
    if (Array.isArray(style)) return [...style, styles.placeholder, { backgroundColor: placeholderColor }];
    return [style, styles.placeholder, { backgroundColor: placeholderColor }];
  }, [style, placeholderColor]);

  const resolvedSource = useMemo(() => {
    if (typeof source !== "string") return source;
    const raw = source.trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("file:")) return source;
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) return source;
    if (raw.includes("/api/image-proxy?")) return source;

    // Only do proxying on web (where caching matters most). On native, direct URLs are fine.
    if (Platform.OS !== "web") return source;

    // Request thumbnails through the server cache for faster loads.
    // IMPORTANT: use a DPI-aware size so artwork stays crisp on high-DPI screens.
    const flat = StyleSheet.flatten(style) || {};
    const w = typeof flat.width === "number" ? flat.width : null;
    const h = typeof flat.height === "number" ? flat.height : null;
    const dim = Math.max(w || 0, h || 0);
    const scale =
      Platform.OS === "web"
        ? (typeof window !== "undefined" && (window as any).devicePixelRatio ? Number((window as any).devicePixelRatio) : 1)
        : PixelRatio.get();
    const target = dim > 0 ? dim * (Number.isFinite(scale) && scale > 0 ? scale : 1) : 320;

    // Match server cache buckets: 96/160/320/640
    const requested =
      target > 360 ? 640 :
      target > 180 ? 320 :
      target > 120 ? 160 : 96;

    const apiUrl = getApiUrl();
    const proxied = `${apiUrl}/api/image-proxy?url=${encodeURIComponent(raw)}&w=${requested}&h=${requested}`;

    // Attempt 0: proxied via server cache (fast). If that fails, fall back to direct raw URL.
    return attempt === 0 ? proxied : raw;
  }, [source, style, attempt]);

  // Use the shared placeholder image when artwork is missing or fails to load.
  if (!hasArtwork || failed) {
    return <Image source={PLACEHOLDER_IMAGE} style={mergedStyle} contentFit="cover" />;
  }

  return (
    <Image
      source={typeof resolvedSource === 'string' ? { uri: resolvedSource } : resolvedSource}
      style={mergedStyle}
      contentFit={contentFit}
      onError={() => {
        // On web we try proxy first; if it fails, try direct once before giving up.
        if (Platform.OS === "web" && attempt === 0) {
          setAttempt(1);
          return;
        }
        setFailed(true);
      }}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    // Inherit borderRadius and dimensions from style prop
  },
});

