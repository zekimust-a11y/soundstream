import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SettingsScreen from "@/screens/SettingsScreen";
import ServerManagementScreen from "@/screens/ServerManagementScreen";
import QobuzLoginScreen from "@/screens/QobuzLoginScreen";
import DebugScreen from "@/screens/DebugScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type SettingsStackParamList = {
  Settings: undefined;
  ServerManagement: undefined;
  QobuzLogin: undefined;
  Debug: undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStackNavigator() {
  const screenOptions = useScreenOptions({ transparent: false });

  return (
    <Stack.Navigator screenOptions={screenOptions}>
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
