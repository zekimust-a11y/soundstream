import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, WithSpringConfig } from "react-native-reanimated";
import BrowseStackNavigator from "@/navigation/BrowseStackNavigator";
import PlaylistsStackNavigator from "@/navigation/PlaylistsStackNavigator";
import AlbumsStackNavigator from "@/navigation/AlbumsStackNavigator";
import ArtistsStackNavigator from "@/navigation/ArtistsStackNavigator";
import RadioStackNavigator from "@/navigation/RadioStackNavigator";
import SearchStackNavigator from "@/navigation/SearchStackNavigator";
import MiniPlayer from "@/components/MiniPlayer";
import { useTheme } from "@/hooks/useTheme";
import { Colors, Spacing } from "@/constants/theme";

export type MainTabParamList = {
  BrowseTab: undefined;
  PlaylistsTab: undefined;
  AlbumsTab: undefined;
  ArtistsTab: undefined;
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

  return (
    <Animated.View style={animatedStyle}>
      <Feather 
        name={name} 
        size={size} 
        color={focused ? Colors.light.accent : Colors.light.tabIconDefault} 
      />
    </Animated.View>
  );
};

export default function MainTabNavigator() {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <Tab.Navigator
        initialRouteName="BrowseTab"
        screenOptions={{
          tabBarActiveTintColor: Colors.light.accent,
          tabBarInactiveTintColor: Colors.light.tabIconDefault,
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
              <AnimatedTabIcon name="home" focused={focused} />
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
              <AnimatedTabIcon name="music" focused={focused} />
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
          name="ArtistsTab"
          component={ArtistsStackNavigator}
          options={{
            title: "Artists",
            tabBarIcon: ({ focused }) => (
              <AnimatedTabIcon name="user" focused={focused} />
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
