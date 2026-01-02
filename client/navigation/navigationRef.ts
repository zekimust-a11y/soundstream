import { CommonActions, createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// If the user taps sidebar items before NavigationContainer is "ready", queue the last navigation.
// This prevents silent no-ops that look like broken navigation on web.
let pendingAction: ReturnType<typeof CommonActions.navigate> | null = null;

export function flushPendingNavigation() {
  if (!navigationRef.isReady()) return;
  if (!pendingAction) return;
  navigationRef.dispatch(pendingAction);
  pendingAction = null;
}

export function navigate<RouteName extends keyof RootStackParamList>(
  ...args: undefined extends RootStackParamList[RouteName]
    ? [screen: RouteName] | [screen: RouteName, params: RootStackParamList[RouteName]]
    : [screen: RouteName, params: RootStackParamList[RouteName]]
) {
  const action = CommonActions.navigate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(args as any)
  );

  if (!navigationRef.isReady()) {
    pendingAction = action;
    return;
  }

  navigationRef.dispatch(action);
}


