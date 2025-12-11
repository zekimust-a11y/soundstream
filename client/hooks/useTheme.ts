import { Colors } from "@/constants/theme";

export function useTheme() {
  const isDark = false;
  const theme = Colors.light;

  return {
    theme,
    isDark,
  };
}
