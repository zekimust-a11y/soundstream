import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Alert,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useMusic } from "@/hooks/useMusic";

export default function QobuzLoginScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { qobuzConnected, connectQobuz, disconnectQobuz, isLoading } = useMusic();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleConnect = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter your email and password");
      return;
    }

    const success = await connectQobuz(email.trim(), password.trim());
    if (success) {
      Alert.alert("Success", "Connected to Qobuz successfully", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } else {
      Alert.alert("Error", "Failed to connect to Qobuz. Please check your credentials.");
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect Qobuz",
      "Are you sure you want to disconnect your Qobuz account?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            disconnectQobuz();
            setEmail("");
            setPassword("");
          },
        },
      ]
    );
  };

  if (qobuzConnected) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
          <View style={styles.connectedState}>
            <View style={styles.qobuzLogo}>
              <Feather name="headphones" size={48} color="#F99C38" />
            </View>
            <ThemedText style={styles.connectedTitle}>
              Connected to Qobuz
            </ThemedText>
            <ThemedText style={styles.connectedSubtitle}>
              Your Qobuz account is linked. You can browse and stream
              high-resolution music from your library.
            </ThemedText>

            <View style={styles.featureList}>
              <View style={styles.featureItem}>
                <Feather name="check-circle" size={18} color={Colors.dark.success} />
                <ThemedText style={styles.featureText}>
                  Stream up to 24-bit/192kHz audio
                </ThemedText>
              </View>
              <View style={styles.featureItem}>
                <Feather name="check-circle" size={18} color={Colors.dark.success} />
                <ThemedText style={styles.featureText}>
                  Access your Qobuz favorites
                </ThemedText>
              </View>
              <View style={styles.featureItem}>
                <Feather name="check-circle" size={18} color={Colors.dark.success} />
                <ThemedText style={styles.featureText}>
                  Search millions of tracks
                </ThemedText>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.disconnectButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              onPress={handleDisconnect}
            >
              <ThemedText style={styles.disconnectButtonText}>
                Disconnect Account
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.qobuzLogo}>
            <Feather name="headphones" size={48} color="#F99C38" />
          </View>
          <ThemedText style={styles.title}>Connect to Qobuz</ThemedText>
          <ThemedText style={styles.subtitle}>
            Sign in with your Qobuz account to stream high-resolution music
          </ThemedText>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <ThemedText style={styles.inputLabel}>Email</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="your@email.com"
              placeholderTextColor={Colors.dark.textTertiary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.inputLabel}>Password</ThemedText>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                placeholderTextColor={Colors.dark.textTertiary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password"
              />
              <Pressable
                style={({ pressed }) => [
                  styles.eyeButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={20}
                  color={Colors.dark.textSecondary}
                />
              </Pressable>
            </View>
          </View>

          <Button
            title={isLoading ? "Connecting..." : "Connect"}
            onPress={handleConnect}
            disabled={isLoading}
            style={styles.connectButton}
          />

          <ThemedText style={styles.disclaimer}>
            By connecting, you agree to share your Qobuz library data with this
            app for playback purposes only.
          </ThemedText>
        </View>

        <View style={styles.helpSection}>
          <ThemedText style={styles.helpTitle}>
            Don't have a Qobuz account?
          </ThemedText>
          <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <ThemedText style={styles.helpLink}>
              Sign up at qobuz.com
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    flexGrow: 1,
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  qobuzLogo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#F99C38" + "20",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.display,
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  form: {
    marginBottom: Spacing["2xl"],
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    ...Typography.caption,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    height: Spacing.inputHeight,
    color: Colors.dark.text,
    ...Typography.body,
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    height: Spacing.inputHeight,
    color: Colors.dark.text,
    ...Typography.body,
  },
  eyeButton: {
    padding: Spacing.md,
  },
  connectButton: {
    marginTop: Spacing.md,
  },
  disclaimer: {
    ...Typography.caption,
    color: Colors.dark.textTertiary,
    textAlign: "center",
    marginTop: Spacing.lg,
  },
  helpSection: {
    alignItems: "center",
    marginTop: "auto",
    paddingTop: Spacing.xl,
  },
  helpTitle: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.xs,
  },
  helpLink: {
    ...Typography.body,
    color: Colors.dark.accent,
  },
  connectedState: {
    flex: 1,
    alignItems: "center",
    paddingTop: Spacing["3xl"],
  },
  connectedTitle: {
    ...Typography.title,
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
  },
  connectedSubtitle: {
    ...Typography.body,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  featureList: {
    alignSelf: "stretch",
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  featureText: {
    ...Typography.body,
    color: Colors.dark.text,
  },
  disconnectButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  disconnectButtonText: {
    ...Typography.body,
    color: Colors.dark.error,
  },
});
