import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import BrowseScreen from "@/screens/BrowseScreen";
import ArtistScreen from "@/screens/ArtistScreen";
import AlbumScreen from "@/screens/AlbumScreen";
import PlaylistsScreen from "@/screens/PlaylistsScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type BrowseStackParamList = {
  Browse: undefined;
  Artist: { id: string; name: string };
  Album: { id: string; name: string; artistName: string };
  Playlists: undefined;
};

const Stack = createNativeStackNavigator<BrowseStackParamList>();

export default function BrowseStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Browse"
        component={BrowseScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Artist"
        component={ArtistScreen}
        options={({ route }) => ({
          headerTitle: route.params.name,
        })}
      />
      <Stack.Screen
        name="Album"
        component={AlbumScreen}
        options={({ route }) => ({
          headerTitle: route.params.name,
        })}
      />
      <Stack.Screen
        name="Playlists"
        component={PlaylistsScreen}
        options={{ headerTitle: "Playlists" }}
      />
    </Stack.Navigator>
  );
}
