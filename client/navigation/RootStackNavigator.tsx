import React from "react";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import SearchStackNavigator from "@/navigation/SearchStackNavigator";
import NowPlayingScreen from "@/screens/NowPlayingScreen";
import QueueScreen from "@/screens/QueueScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { PlaybackProvider } from "@/hooks/usePlayback";
import { MusicProvider } from "@/hooks/useMusic";
import { SettingsProvider } from "@/hooks/useSettings";
import { VolumeToast } from "@/components/VolumeToast";

export type RootStackParamList = {
  Main: {
    screen?: keyof import('./MainTabNavigator').MainTabParamList;
    params?: any;
  };
  // Nested Search stack (SearchScreen is the initial route). We keep params loose here.
  SearchModal: any;
  NowPlaying: undefined;
  Queue: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <SettingsProvider>
      <MusicProvider>
        <PlaybackProvider>
          <>
            <Stack.Navigator screenOptions={screenOptions}>
              <Stack.Screen
                name="Main"
                component={MainTabNavigator}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="SearchModal"
                component={SearchStackNavigator as any}
                options={{
                  headerShown: false,
                  presentation: "fullScreenModal",
                }}
              />
              <Stack.Group
                screenOptions={{
                  headerShown: false,
                  presentation: "fullScreenModal",
                  animation: "fade",
                  contentStyle: {
                    backgroundColor: "transparent",
                  },
                  headerStyle: {
                    backgroundColor: "transparent",
                  },
                  headerTransparent: true,
                  // We handle swipe-to-minimize manually inside NowPlayingScreen
                  // to avoid accidental dismissals from the native stack gesture,
                  // especially on iOS when the user is not interacting.
                  gestureEnabled: false,
                  fullScreenGestureEnabled: false,
                }}
              >
                <Stack.Screen name="NowPlaying" component={NowPlayingScreen} />
              </Stack.Group>
              <Stack.Screen
                name="Queue"
                component={QueueScreen}
                options={{ 
                  headerShown: false,
                  presentation: "fullScreenModal",
                  animation: "fade",
                  contentStyle: {
                    backgroundColor: "transparent",
                  },
                }}
              />
            </Stack.Navigator>
            <VolumeToast />
          </>
        </PlaybackProvider>
      </MusicProvider>
    </SettingsProvider>
  );
}
