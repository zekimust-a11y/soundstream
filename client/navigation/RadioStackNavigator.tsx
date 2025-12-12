import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import RadioScreen from "@/screens/RadioScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type RadioStackParamList = {
  Radio: undefined;
};

const Stack = createNativeStackNavigator<RadioStackParamList>();

export default function RadioStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Radio"
        component={RadioScreen}
        options={{ headerTitle: "Radio" }}
      />
    </Stack.Navigator>
  );
}
