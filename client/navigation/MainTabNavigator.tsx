import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BrowseStackNavigator from "@/navigation/BrowseStackNavigator";
import QueueScreen from "@/screens/QueueScreen";
import SearchStackNavigator from "@/navigation/SearchStackNavigator";
import SettingsStackNavigator from "@/navigation/SettingsStackNavigator";
import { useTheme } from "@/hooks/useTheme";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { usePlayback } from "@/hooks/usePlayback";
import { Image } from "expo-image";

export type MainTabParamList = {
  BrowseTab: undefined;
  QueueTab: undefined;
  SearchTab: undefined;
  SettingsTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

function FloatingNowPlayingButton() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { currentTrack, isPlaying } = usePlayback();

  if (!currentTrack) return null;

  return (
    <Pressable
      onPress={() => navigation.navigate("NowPlaying")}
      style={({ pressed }) => [
        styles.floatingButton,
        { bottom: 60 + insets.bottom + Spacing.lg, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={styles.floatingButtonContent}>
        <Image
          source={currentTrack.albumArt || require("../assets/images/placeholder-album.png")}
          style={styles.floatingAlbumArt}
          contentFit="cover"
        />
        <View style={styles.floatingTextContainer}>
          <View style={styles.floatingTrackInfo}>
            <Feather
              name={isPlaying ? "pause" : "play"}
              size={16}
              color={Colors.light.text}
              style={styles.floatingIcon}
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

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
          name="QueueTab"
          component={QueueScreen}
          options={{
            title: "Queue",
            tabBarIcon: ({ color, size }) => (
              <Feather name="list" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="SearchTab"
          component={SearchStackNavigator}
          options={{
            title: "Search",
            tabBarIcon: ({ color, size }) => (
              <Feather name="search" size={size} color={color} />
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
      <FloatingNowPlayingButton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  floatingButton: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: Colors.light.accentSecondary,
    borderRadius: BorderRadius.full,
    padding: Spacing.sm,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  floatingButtonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  floatingAlbumArt: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
  },
  floatingTextContainer: {
    marginLeft: Spacing.sm,
  },
  floatingTrackInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  floatingIcon: {
    marginRight: Spacing.xs,
  },
});
