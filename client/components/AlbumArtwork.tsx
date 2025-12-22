import React from "react";
import { View, StyleSheet, ImageSourcePropType } from "react-native";
import { Image } from "expo-image";
import { Colors, BorderRadius } from "@/constants/theme";

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
  // Check if source is valid (not empty string, null, or undefined)
  // Also check if it's a valid URI (not just whitespace or placeholder text)
  const hasArtwork = source && 
    (typeof source === 'string' 
      ? source.trim().length > 0 && 
        !source.includes('placeholder') && 
        !source.includes('undefined') &&
        !source.includes('null')
      : true);

  if (!hasArtwork) {
    // Return dark grey placeholder View with same dimensions as Image
    // Merge style to ensure dimensions are preserved
    const mergedStyle = style 
      ? (Array.isArray(style) 
          ? [...style, styles.placeholder, { backgroundColor: placeholderColor }]
          : [style, styles.placeholder, { backgroundColor: placeholderColor }])
      : [styles.placeholder, { backgroundColor: placeholderColor, width: 100, height: 100 }];
    
    return (
      <View style={mergedStyle} />
    );
  }

  return (
    <Image
      source={typeof source === 'string' ? { uri: source } : source}
      style={style}
      contentFit={contentFit}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    // Inherit borderRadius and dimensions from style prop
  },
});

