import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import BrowseScreen from "@/screens/BrowseScreen";
import ArtistScreen from "@/screens/ArtistScreen";
import AlbumScreen from "@/screens/AlbumScreen";
import AllAlbumsScreen from "@/screens/AllAlbumsScreen";
import AllArtistsScreen from "@/screens/AllArtistsScreen";
import NowPlayingScreen from "@/screens/NowPlayingScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import ServerManagementScreen from "@/screens/ServerManagementScreen";
import QobuzLoginScreen from "@/screens/QobuzLoginScreen";
import DebugScreen from "@/screens/DebugScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type BrowseStackParamList = {
  Browse: undefined;
  Artist: { id: string; name: string };
  Album: { id: string; name: string; artistName: string };
  AllAlbums: undefined;
  AllArtists: undefined;
  NowPlaying: undefined;
  Settings: undefined;
  ServerManagement: undefined;
  QobuzLogin: undefined;
  Debug: undefined;
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
        name="AllAlbums"
        component={AllAlbumsScreen}
        options={{ headerTitle: "All Albums" }}
      />
      <Stack.Screen
        name="AllArtists"
        component={AllArtistsScreen}
        options={{ headerTitle: "All Artists" }}
      />
      <Stack.Screen
        name="NowPlaying"
        component={NowPlayingScreen}
        options={{ 
          headerShown: false,
          presentation: "modal",
        }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ headerTitle: "Settings" }}
      />
      <Stack.Screen
        name="ServerManagement"
        component={ServerManagementScreen}
        options={{ headerTitle: "Servers" }}
      />
      <Stack.Screen
        name="QobuzLogin"
        component={QobuzLoginScreen}
        options={{ headerTitle: "Qobuz" }}
      />
      <Stack.Screen
        name="Debug"
        component={DebugScreen}
        options={{ headerTitle: "Debug Console" }}
      />
    </Stack.Navigator>
  );
}
