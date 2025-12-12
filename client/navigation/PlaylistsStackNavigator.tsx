import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PlaylistsScreen from "@/screens/PlaylistsScreen";
import PlaylistDetailScreen from "@/screens/PlaylistDetailScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import type { LmsPlaylist } from "@/lib/lmsClient";

export type PlaylistsStackParamList = {
  Playlists: undefined;
  PlaylistDetail: { playlist: LmsPlaylist };
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
      <Stack.Screen
        name="PlaylistDetail"
        component={PlaylistDetailScreen}
        options={{ headerTitle: "" }}
      />
    </Stack.Navigator>
  );
}
