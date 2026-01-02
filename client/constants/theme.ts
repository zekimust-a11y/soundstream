import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#1C1C1E",
    textSecondary: "#6B6B70",
    textTertiary: "#8E8E93",
    buttonText: "#FFFFFF",
    tabIconDefault: "#8E8E93",
    tabIconSelected: "#007AFF",
    link: "#007AFF",
    // Slightly whiter app background (less grey)
    backgroundRoot: "#FBFBFE",
    backgroundDefault: "#FFFFFF",
    backgroundSecondary: "#F2F2F7",
    backgroundTertiary: "#E5E5EA",
    accent: "#007AFF",
    accentSecondary: "#5856D6",
    border: "#D1D1D6",
    success: "#34C759",
    warning: "#FF9500",
    error: "#FF3B30",
  },
  dark: {
    text: "#FFFFFF",
    textSecondary: "#A8A8B0",
    textTertiary: "#5E5E63",
    buttonText: "#FFFFFF",
    tabIconDefault: "#5E5E63",
    tabIconSelected: "#4A9EFF",
    link: "#4A9EFF",
    backgroundRoot: "#0A0A0C",
    backgroundDefault: "#1C1C1E",
    backgroundSecondary: "#2C2C2E",
    backgroundTertiary: "#38383A",
    accent: "#4A9EFF",
    accentSecondary: "#7C7CFF",
    border: "#38383A",
    success: "#34C759",
    warning: "#FF9F0A",
    error: "#FF453A",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  "2xl": 40,
  "3xl": 50,
  full: 9999,
};

// Roon Arc font configuration
// iOS: SF Pro Display for large text, SF Pro Text for body text
// Android: Roboto
// Web: SF Pro font stack
const getFontFamily = (isDisplay: boolean = false) => {
  return Platform.select({
    ios: undefined, // iOS uses SF Pro by default (system font)
    android: undefined, // Android uses Roboto by default (system font)
    web: isDisplay
      ? "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"
      : "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    default: undefined,
  });
};

export const Typography = {
  display: {
    fontSize: 32,
    fontWeight: "700" as const,
    fontFamily: getFontFamily(true),
  },
  title: {
    fontSize: 22,
    fontWeight: "600" as const,
    fontFamily: getFontFamily(true),
  },
  headline: {
    fontSize: 17,
    fontWeight: "600" as const,
    fontFamily: getFontFamily(false),
  },
  body: {
    fontSize: 15,
    fontWeight: "400" as const,
    fontFamily: getFontFamily(false),
  },
  caption: {
    fontSize: 13,
    fontWeight: "400" as const,
    fontFamily: getFontFamily(false),
  },
  label: {
    fontSize: 11,
    fontWeight: "500" as const,
    fontFamily: getFontFamily(false),
  },
  h1: {
    fontSize: 32,
    fontWeight: "700" as const,
    fontFamily: getFontFamily(true),
  },
  h2: {
    fontSize: 28,
    fontWeight: "700" as const,
    fontFamily: getFontFamily(true),
  },
  h3: {
    fontSize: 24,
    fontWeight: "600" as const,
    fontFamily: getFontFamily(true),
  },
  h4: {
    fontSize: 20,
    fontWeight: "600" as const,
    fontFamily: getFontFamily(true),
  },
  small: {
    fontSize: 14,
    fontWeight: "400" as const,
    fontFamily: getFontFamily(false),
  },
  link: {
    fontSize: 16,
    fontWeight: "400" as const,
    fontFamily: getFontFamily(false),
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

const createShadow = (webShadow: string, nativeShadow: {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}) => {
  if (Platform.OS === 'web') {
    return { boxShadow: webShadow } as any;
  }
  return nativeShadow;
};

export const Shadows = {
  small: createShadow(
    "0px 2px 4px rgba(0, 0, 0, 0.1)",
    {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    }
  ),
  medium: createShadow(
    "0px 4px 8px rgba(0, 0, 0, 0.15)",
    {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
    }
  ),
  large: createShadow(
    "0px 8px 16px rgba(0, 0, 0, 0.2)",
    {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 8,
    }
  ),
};
