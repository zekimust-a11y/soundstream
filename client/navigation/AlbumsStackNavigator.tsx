import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AllAlbumsScreen from "@/screens/AllAlbumsScreen";
import AlbumScreen from "@/screens/AlbumScreen";
import ArtistScreen from "@/screens/ArtistScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type AlbumsStackParamList = {
  AllAlbums: undefined;
  Album: { id: string; name: string; artistName?: string };
  Artist: { id: string; name: string };
};

const Stack = createNativeStackNavigator<AlbumsStackParamList>();

export default function AlbumsStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="AllAlbums"
        component={AllAlbumsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Album"
        component={AlbumScreen}
        options={({ route }) => ({ headerTitle: route.params.name })}
      />
      <Stack.Screen
        name="Artist"
        component={ArtistScreen}
        options={({ route }) => ({ headerTitle: route.params.name })}
      />
    </Stack.Navigator>
  );
}
