import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import NowPlayingScreen from "@/screens/NowPlayingScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { PlaybackProvider } from "@/hooks/usePlayback";
import { MusicProvider } from "@/hooks/useMusic";

export type RootStackParamList = {
  Main: undefined;
  NowPlaying: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <MusicProvider>
      <PlaybackProvider>
        <Stack.Navigator screenOptions={screenOptions}>
          <Stack.Screen
            name="Main"
            component={MainTabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="NowPlaying"
            component={NowPlayingScreen}
            options={{
              presentation: "modal",
              headerShown: false,
            }}
          />
        </Stack.Navigator>
      </PlaybackProvider>
    </MusicProvider>
  );
}
