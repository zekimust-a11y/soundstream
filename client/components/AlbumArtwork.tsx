import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, ImageSourcePropType } from "react-native";
import { Image } from "expo-image";

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

  // Reset failure state when source changes
  useEffect(() => {
    setFailed(false);
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

  // Use the shared placeholder image when artwork is missing or fails to load.
  if (!hasArtwork || failed) {
    return <Image source={PLACEHOLDER_IMAGE} style={mergedStyle} contentFit="cover" />;
  }

  return (
    <Image
      source={typeof source === 'string' ? { uri: source } : source}
      style={mergedStyle}
      contentFit={contentFit}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    // Inherit borderRadius and dimensions from style prop
  },
});

