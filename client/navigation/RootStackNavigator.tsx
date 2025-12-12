import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { PlaybackProvider } from "@/hooks/usePlayback";
import { MusicProvider } from "@/hooks/useMusic";
import { SettingsProvider } from "@/hooks/useSettings";

export type RootStackParamList = {
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <SettingsProvider>
      <MusicProvider>
        <PlaybackProvider>
          <Stack.Navigator screenOptions={screenOptions}>
          <Stack.Screen
            name="Main"
            component={MainTabNavigator}
            options={{ headerShown: false }}
          />
          </Stack.Navigator>
        </PlaybackProvider>
      </MusicProvider>
    </SettingsProvider>
  );
}
