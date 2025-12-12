import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AllArtistsScreen from "@/screens/AllArtistsScreen";
import ArtistScreen from "@/screens/ArtistScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type ArtistsStackParamList = {
  AllArtists: undefined;
  Artist: { id: string; name: string };
};

const Stack = createNativeStackNavigator<ArtistsStackParamList>();

export default function ArtistsStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="AllArtists"
        component={AllArtistsScreen}
        options={{ headerTitle: "Artists" }}
      />
      <Stack.Screen
        name="Artist"
        component={ArtistScreen}
        options={({ route }) => ({ headerTitle: route.params.name })}
      />
    </Stack.Navigator>
  );
}
