import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import BrowseScreen from "@/screens/BrowseScreen";
console.log('BrowseStackNavigator file loaded - importing BrowseScreen from: @/screens/BrowseScreen');
console.log('BrowseScreen imported:', BrowseScreen);
console.log('BrowseScreen type:', typeof BrowseScreen);
import ArtistScreen from "@/screens/ArtistScreen";
import AlbumScreen from "@/screens/AlbumScreen";
import AllAlbumsScreen from "@/screens/AllAlbumsScreen";
import AllArtistsScreen from "@/screens/AllArtistsScreen";
import QobuzBestsellersScreen from "@/screens/QobuzBestsellersScreen";
import QobuzInThePressScreen from "@/screens/QobuzInThePressScreen";
import NowPlayingScreen from "@/screens/NowPlayingScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import QobuzLoginScreen from "@/screens/QobuzLoginScreen";
import DebugScreen from "@/screens/DebugScreen";
import HistoryScreen from "@/screens/HistoryScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type BrowseStackParamList = {
  Browse: { autoShuffle?: boolean } | undefined;
  Artist: { id: string; name: string };
  Album: { id: string; name: string; artistName: string; source?: "qobuz" | "local" | "tidal" };
  AllAlbums: undefined;
  AllArtists: undefined;
  QobuzBestsellers: undefined;
  QobuzInThePress: undefined;
  NowPlaying: undefined;
  Settings: undefined;
  History: undefined;
  QobuzLogin: undefined;
  Debug: undefined;
};

const Stack = createNativeStackNavigator<BrowseStackParamList>();

export default function BrowseStackNavigator() {
  console.log('BrowseStackNavigator is being executed');
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Browse"
        component={BrowseScreen}
        options={{ headerShown: false }}
      />
      {console.log('Browse screen registered in stack')}
      <Stack.Screen
        name="Artist"
        component={ArtistScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Album"
        component={AlbumScreen}
        options={{
          headerShown: false,
        }}
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
        name="QobuzBestsellers"
        component={QobuzBestsellersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QobuzInThePress"
        component={QobuzInThePressScreen}
        options={{ headerShown: false }}
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
        name="History"
        component={HistoryScreen}
        options={{ headerShown: false }}
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
