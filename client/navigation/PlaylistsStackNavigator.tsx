import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PlaylistsScreen from "@/screens/PlaylistsScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type PlaylistsStackParamList = {
  Playlists: undefined;
};

const Stack = createNativeStackNavigator<PlaylistsStackParamList>();

export default function PlaylistsStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Playlists"
        component={PlaylistsScreen}
        options={{ headerTitle: "Playlists" }}
      />
    </Stack.Navigator>
  );
}
