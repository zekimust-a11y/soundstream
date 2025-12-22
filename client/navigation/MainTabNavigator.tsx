import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, WithSpringConfig } from "react-native-reanimated";
import BrowseStackNavigator from "@/navigation/BrowseStackNavigator";
import PlaylistsStackNavigator from "@/navigation/PlaylistsStackNavigator";
import AlbumsStackNavigator from "@/navigation/AlbumsStackNavigator";
import TracksStackNavigator from "@/navigation/TracksStackNavigator";
import RadioStackNavigator from "@/navigation/RadioStackNavigator";
import SearchStackNavigator from "@/navigation/SearchStackNavigator";
import MiniPlayer from "@/components/MiniPlayer";
import { useTheme } from "@/hooks/useTheme";
import { Colors, Spacing } from "@/constants/theme";

export type MainTabParamList = {
  BrowseTab: {
    screen?: keyof import('./BrowseStackNavigator').BrowseStackParamList;
    params?: any;
  };
  PlaylistsTab: undefined;
  AlbumsTab: undefined;
  TracksTab: undefined;
  RadioTab: undefined;
  SearchTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.5,
  stiffness: 200,
  overshootClamping: false,
};

// Instagram-style animated tab icon
const AnimatedTabIcon = ({ 
  name, 
  focused, 
  size = 26 
}: { 
  name: keyof typeof Feather.glyphMap; 
  focused: boolean; 
  size?: number;
}) => {
  const scale = useSharedValue(focused ? 1 : 0.9);
  const opacity = useSharedValue(focused ? 1 : 0.6);

  React.useEffect(() => {
    if (focused) {
      scale.value = withSpring(1, springConfig);
      opacity.value = withSpring(1, springConfig);
    } else {
      scale.value = withSpring(0.9, springConfig);
      opacity.value = withSpring(0.6, springConfig);
    }
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const iconColor = focused ? "#000000" : "#4A4A4A";

  return (
    <Animated.View style={animatedStyle}>
      <Feather 
        name={name} 
        size={size} 
        color={iconColor} 
      />
    </Animated.View>
  );
};

// Minimalist home icon - empty outline with rounded corners and soft glow (like reference image)
const TidalHomeIcon = ({ focused, size = 26 }: { focused: boolean; size?: number }) => {
  const scale = useSharedValue(focused ? 1 : 0.95);
  const opacity = useSharedValue(focused ? 1 : 0.75);

  React.useEffect(() => {
    if (focused) {
      scale.value = withSpring(1, springConfig);
      opacity.value = withSpring(1, springConfig);
    } else {
      scale.value = withSpring(0.95, springConfig);
      opacity.value = withSpring(0.75, springConfig);
    }
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  // Light gray/white color with subtle glow (matching reference image)
  const iconColor = focused ? "#CCCCCC" : "#B0B0B0";
  const glowColor = focused ? "rgba(204, 204, 204, 0.5)" : "rgba(176, 176, 176, 0.35)";
  const strokeWidth = 2.5; // Thicker lines like reference
  const containerSize = size;
  const houseWidth = size * 0.72;
  const houseHeight = size * 0.5;
  const roofHeight = size * 0.3;
  const cornerRadius = 2.5; // Slightly rounded corners

  return (
    <Animated.View style={[animatedStyle, { width: containerSize, height: containerSize, justifyContent: 'center', alignItems: 'center' }]}>
      <View style={{ width: containerSize, height: containerSize, justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
        {/* Soft glow effect around entire house shape */}
        <View
          style={{
            position: 'absolute',
            top: (containerSize - houseHeight - roofHeight) / 2 - 2,
            left: (containerSize - houseWidth) / 2 - 2,
            width: houseWidth + 4,
            height: houseHeight + roofHeight + 4,
            borderRadius: cornerRadius + 1,
            backgroundColor: 'transparent',
            shadowColor: glowColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 5,
            elevation: 0,
          }}
        />
        {/* House roof (triangle outline) */}
        <View
          style={{
            position: 'absolute',
            top: (containerSize - houseHeight - roofHeight) / 2,
            left: (containerSize - houseWidth) / 2,
            width: 0,
            height: 0,
            borderLeftWidth: houseWidth / 2,
            borderRightWidth: houseWidth / 2,
            borderBottomWidth: roofHeight,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: iconColor,
            borderStyle: 'solid',
            // Add glow to roof
            shadowColor: glowColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 3,
          }}
        />
        {/* House base (empty outline only, rounded corners) */}
        <View
          style={{
            position: 'absolute',
            bottom: (containerSize - houseHeight - roofHeight) / 2,
            left: (containerSize - houseWidth) / 2,
            width: houseWidth,
            height: houseHeight,
            borderWidth: strokeWidth,
            borderRadius: cornerRadius,
            borderColor: iconColor,
            backgroundColor: 'transparent',
            // Add glow to base
            shadowColor: glowColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 3,
          }}
        />
      </View>
    </Animated.View>
  );
};

// Custom playlist icon (list lines + musical note)
const PlaylistIcon = ({ focused, size = 26 }: { focused: boolean; size?: number }) => {
  const scale = useSharedValue(focused ? 1 : 0.9);
  const opacity = useSharedValue(focused ? 1 : 0.6);

  React.useEffect(() => {
    if (focused) {
      scale.value = withSpring(1, springConfig);
      opacity.value = withSpring(1, springConfig);
    } else {
      scale.value = withSpring(0.9, springConfig);
      opacity.value = withSpring(0.6, springConfig);
    }
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const iconColor = focused ? "#000000" : "#4A4A4A";

  return (
    <Animated.View style={[animatedStyle, { width: size, height: size, position: 'relative' }]}>
      {/* Three horizontal lines (list icon) */}
      <View style={{ position: 'absolute', left: 0, top: size * 0.15, width: size * 0.5 }}>
        <View style={{ height: 2, backgroundColor: iconColor, borderRadius: 1, marginBottom: 4 }} />
        <View style={{ height: 2, backgroundColor: iconColor, borderRadius: 1, marginBottom: 4 }} />
        <View style={{ height: 2, backgroundColor: iconColor, borderRadius: 1 }} />
      </View>
      {/* Musical note */}
      <View style={{ position: 'absolute', right: 0, top: size * 0.1 }}>
        <Feather name="music" size={size * 0.7} color={iconColor} />
      </View>
    </Animated.View>
  );
};

// Custom track icon (document with musical note)
const TrackIcon = ({ focused, size = 26 }: { focused: boolean; size?: number }) => {
  const scale = useSharedValue(focused ? 1 : 0.9);
  const opacity = useSharedValue(focused ? 1 : 0.6);

  React.useEffect(() => {
    if (focused) {
      scale.value = withSpring(1, springConfig);
      opacity.value = withSpring(1, springConfig);
    } else {
      scale.value = withSpring(0.9, springConfig);
      opacity.value = withSpring(0.6, springConfig);
    }
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const iconColor = focused ? "#000000" : "#4A4A4A";
  const strokeWidth = 2;
  const docWidth = size * 0.75;
  const docHeight = size * 0.85;
  const foldSize = size * 0.2;

  return (
    <Animated.View style={[animatedStyle, { width: size, height: size, justifyContent: 'center', alignItems: 'center', position: 'relative' }]}>
      <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
        {/* Document rectangle */}
        <View
          style={{
            position: 'absolute',
            width: docWidth,
            height: docHeight,
            borderWidth: strokeWidth,
            borderRadius: 2,
            borderColor: iconColor,
            backgroundColor: 'transparent',
          }}
        />
        {/* Folded corner (top-right) */}
        <View
          style={{
            position: 'absolute',
            top: (size - docHeight) / 2,
            right: (size - docWidth) / 2,
            width: 0,
            height: 0,
            borderTopWidth: foldSize,
            borderRightWidth: foldSize,
            borderTopColor: iconColor,
            borderRightColor: 'transparent',
            borderLeftColor: 'transparent',
            borderBottomColor: 'transparent',
            borderStyle: 'solid',
          }}
        />
        {/* Folded corner line (diagonal) */}
        <View
          style={{
            position: 'absolute',
            top: (size - docHeight) / 2,
            right: (size - docWidth) / 2,
            width: foldSize * 0.7,
            height: strokeWidth,
            backgroundColor: iconColor,
            transform: [{ rotate: '45deg' }],
          }}
        />
        {/* Musical note centered */}
        <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
          <Feather name="music" size={size * 0.5} color={iconColor} />
        </View>
      </View>
    </Animated.View>
  );
};

export default function MainTabNavigator() {
  const { theme } = useTheme();

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Tab.Navigator
        initialRouteName="BrowseTab"
        screenOptions={{
          tabBarActiveTintColor: "#000000",
          tabBarInactiveTintColor: "#4A4A4A",
          tabBarShowLabel: false,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "500",
            marginTop: -4,
            marginBottom: Platform.OS === "ios" ? 0 : 4,
          },
          tabBarIconStyle: {
            marginTop: Platform.OS === "ios" ? 4 : 0,
          },
          tabBarStyle: {
            position: "absolute",
            height: Platform.OS === "ios" ? 88 : 64,
            paddingBottom: Platform.OS === "ios" ? 28 : 8,
            paddingTop: Platform.OS === "ios" ? 8 : 8,
            backgroundColor: Platform.select({
              ios: "transparent",
              android: Colors.light.backgroundDefault,
            }),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: Colors.light.border,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarBackground: () =>
            Platform.OS === "ios" ? (
              <View style={StyleSheet.absoluteFill}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255, 255, 255, 0.9)' }]} />
                <BlurView
                  intensity={95}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                />
              </View>
            ) : null,
          headerShown: false,
        }}
      >
        <Tab.Screen
          name="BrowseTab"
          component={BrowseStackNavigator}
          options={{
            title: "Browse",
            tabBarIcon: ({ focused }) => (
              <TidalHomeIcon focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="SearchTab"
          component={SearchStackNavigator}
          options={{
            title: "Search",
            tabBarIcon: ({ focused }) => (
              <AnimatedTabIcon name="search" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="PlaylistsTab"
          component={PlaylistsStackNavigator}
          options={{
            title: "Playlists",
            tabBarIcon: ({ focused }) => (
              <PlaylistIcon focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="AlbumsTab"
          component={AlbumsStackNavigator}
          options={{
            title: "Albums",
            tabBarIcon: ({ focused }) => (
              <AnimatedTabIcon name="disc" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="TracksTab"
          component={TracksStackNavigator}
          options={{
            title: "Tracks",
            tabBarIcon: ({ focused }) => (
              <TrackIcon focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="RadioTab"
          component={RadioStackNavigator}
          options={{
            title: "Radio",
            tabBarIcon: ({ focused }) => (
              <AnimatedTabIcon name="radio" focused={focused} />
            ),
          }}
        />
      </Tab.Navigator>
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
