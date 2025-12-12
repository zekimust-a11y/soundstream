import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import BrowseStackNavigator from "@/navigation/BrowseStackNavigator";
import PlaylistsStackNavigator from "@/navigation/PlaylistsStackNavigator";
import QueueStackNavigator from "@/navigation/QueueStackNavigator";
import SettingsStackNavigator from "@/navigation/SettingsStackNavigator";
import MiniPlayer from "@/components/MiniPlayer";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";

export type MainTabParamList = {
  BrowseTab: undefined;
  PlaylistsTab: undefined;
  QueueTab: undefined;
  SettingsTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <Tab.Navigator
        initialRouteName="BrowseTab"
        screenOptions={{
          tabBarActiveTintColor: Colors.light.accent,
          tabBarInactiveTintColor: Colors.light.tabIconDefault,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: Platform.select({
              ios: "transparent",
              android: Colors.light.backgroundRoot,
            }),
            borderTopWidth: 0,
            elevation: 0,
          },
          tabBarBackground: () =>
            Platform.OS === "ios" ? (
              <View style={StyleSheet.absoluteFill}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255, 255, 255, 0.85)' }]} />
                <BlurView
                  intensity={80}
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
            tabBarIcon: ({ color, size }) => (
              <Feather name="disc" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="PlaylistsTab"
          component={PlaylistsStackNavigator}
          options={{
            title: "Playlists",
            tabBarIcon: ({ color, size }) => (
              <Feather name="list" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="QueueTab"
          component={QueueStackNavigator}
          options={{
            title: "Queue",
            tabBarIcon: ({ color, size }) => (
              <Feather name="play-circle" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="SettingsTab"
          component={SettingsStackNavigator}
          options={{
            title: "Settings",
            tabBarIcon: ({ color, size }) => (
              <Feather name="settings" size={size} color={color} />
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
