import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AllTracksScreen from "@/screens/AllTracksScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type TracksStackParamList = {
  AllTracks: undefined;
};

const Stack = createNativeStackNavigator<TracksStackParamList>();

export default function TracksStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="AllTracks"
        component={AllTracksScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}















