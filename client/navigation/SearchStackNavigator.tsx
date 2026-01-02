import React from "react";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SearchScreen from "@/screens/SearchScreen";
import ArtistScreen from "@/screens/ArtistScreen";
import AlbumScreen from "@/screens/AlbumScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type SearchStackParamList = {
  Search: { initialQuery?: string } | undefined;
  Artist: { id: string; name: string };
  Album: { id: string; name: string; artistName: string };
};

const Stack = createNativeStackNavigator<SearchStackParamList>();

export default function SearchStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Search"
        component={SearchScreen}
        options={{ 
          headerShown: false,
          // Prevent keyboard from pushing content up and hiding tab bar
          ...(Platform.OS === 'android' && {
            keyboardHandlingEnabled: false,
          }),
        }}
      />
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
    </Stack.Navigator>
  );
}
