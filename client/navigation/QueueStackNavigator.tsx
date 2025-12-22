import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import NowPlayingScreen from "@/screens/NowPlayingScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type QueueStackParamList = {
  NowPlaying: undefined;
};

const Stack = createNativeStackNavigator<QueueStackParamList>();

export default function QueueStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="NowPlaying"
        component={NowPlayingScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
