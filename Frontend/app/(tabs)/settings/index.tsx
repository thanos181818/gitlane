import SettingsRow from "@/components/SettingsRow";
import SettingsSection from "@/components/SettingsSection";
import Colors from "@/constants/colors";
import { Radius, Spacing } from "@/constants/theme";
import { useGit } from "@/contexts/GitContext";
import {
  openVerificationUrl,
  pollDeviceToken,
  startDeviceAuth,
} from "@/services/github/api";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  Bell,
  BellOff,
  Check,
  Download,
  Eye,
  FileCheck,
  FileText,
  HardDrive,
  HeartPulse,
  Info,
  Mail,
  Palette,
  RefreshCw,
  Shield,
  Trash2,
  Type,
  User,
  Wifi,
  X,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, showToast } = useGit();
  const [editModal, setEditModal] = useState<
    "name" | "email" | "github" | "githubClientId" | null
  >(null);
  const [editValue, setEditValue] = useState("");
  const [deviceModalVisible, setDeviceModalVisible] = useState(false);
  const [deviceUserCode, setDeviceUserCode] = useState("");
  const [deviceVerificationUrl, setDeviceVerificationUrl] = useState("");
  const [devicePolling, setDevicePolling] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<
    "idle" | "waiting" | "verified" | "error"
  >("idle");

  const openEdit = (field: "name" | "email" | "github" | "githubClientId") => {
    setEditValue(
      field === "name"
        ? settings.userConfig.name
        : field === "email"
          ? settings.userConfig.email
          : field === "github"
            ? (settings.githubToken ?? "")
            : (settings.githubClientId ?? ""),
    );
    setEditModal(field);
  };

  const saveEdit = () => {
    if (!editModal) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    if (editModal === "name") {
      updateSettings({
        userConfig: { ...settings.userConfig, name: editValue },
      });
    } else if (editModal === "email") {
      updateSettings({
        userConfig: { ...settings.userConfig, email: editValue },
      });
    } else if (editModal === "github") {
      updateSettings({ githubToken: editValue.trim() || null });
    } else if (editModal === "githubClientId") {
      updateSettings({ githubClientId: editValue.trim() || null });
    }
    showToast(
      "success",
      `${
        editModal === "name"
          ? "Name"
          : editModal === "email"
            ? "Email"
            : editModal === "github"
              ? "GitHub Token"
              : "GitHub Client ID"
      } updated`,
    );
    setEditModal(null);
  };

  const handleClearCache = () => {
    Alert.alert("Clear Cache", "This will remove 45 MB of cached data.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => showToast("success", "Cache cleared"),
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title="Git Identity">
          <SettingsRow
            icon={<User size={18} color={Colors.accentPrimary} />}
            title="User Name"
            value={settings.userConfig.name ? settings.userConfig.name : "Not set"}
            onPress={() => openEdit("name")}
          />
          <SettingsRow
            icon={<Mail size={18} color={Colors.accentPrimary} />}
            title="Email Address"
            value={settings.userConfig.email ? settings.userConfig.email : "Not set"}
            onPress={() => openEdit("email")}
            isLast
          />
        </SettingsSection>

        <SettingsSection title="GitHub">
          <SettingsRow
            icon={<Shield size={18} color={Colors.accentPrimary} />}
            title="Access Token"
            value={settings.githubToken ? "••••••••" : "Not set"}
            onPress={() => openEdit("github")}
          />
          <SettingsRow
            icon={<Shield size={18} color={Colors.accentPrimary} />}
            title="Client ID"
            value={
              settings.githubClientId ? settings.githubClientId : "Not set"
            }
            onPress={() => openEdit("githubClientId")}
          />
          <SettingsRow
            icon={<Shield size={18} color={Colors.accentPrimary} />}
            title="Sign in to GitHub"
            onPress={async () => {
              if (!settings.githubClientId) {
                showToast("warning", "Set GitHub Client ID first");
                return;
              }
              try {
                const flow = await startDeviceAuth(settings.githubClientId);
                setDeviceUserCode(flow.user_code);
                setDeviceVerificationUrl(flow.verification_uri);
                setDeviceModalVisible(true);
                await Clipboard.setStringAsync(flow.user_code);
                showToast(
                  "info",
                  `Enter GitHub code: ${flow.user_code} (copied)`,
                );
                setDevicePolling(true);
                setDeviceStatus("waiting");
                pollDeviceToken(
                  settings.githubClientId,
                  flow.device_code,
                  flow.interval,
                )
                  .then((token) => {
                    updateSettings({ githubToken: token });
                    showToast("success", "GitHub account linked");
                    setDevicePolling(false);
                    setDeviceStatus("verified");
                    setTimeout(() => {
                      setDeviceModalVisible(false);
                      setDeviceStatus("idle");
                    }, 1200);
                  })
                  .catch((err: any) => {
                    setDevicePolling(false);
                    setDeviceStatus("error");
                    showToast("error", err?.message ?? "GitHub sign-in failed");
                  });
              } catch (err: any) {
                showToast("error", err?.message ?? "GitHub sign-in failed");
              }
            }}
            isLast
          />
        </SettingsSection>

        <SettingsSection title="Notifications">
          <SettingsRow
            icon={<Bell size={18} color={Colors.accentPrimary} />}
            title="Commit Success"
            isToggle
            toggleValue={settings.notifications.commitSuccess}
            onToggle={(val) =>
              updateSettings({
                notifications: {
                  ...settings.notifications,
                  commitSuccess: val,
                },
              })
            }
          />
          <SettingsRow
            icon={<BellOff size={18} color={Colors.accentDanger} />}
            title="Commit Failed"
            isToggle
            toggleValue={settings.notifications.commitFailed}
            onToggle={(val) =>
              updateSettings({
                notifications: { ...settings.notifications, commitFailed: val },
              })
            }
          />
          <SettingsRow
            icon={<Bell size={18} color={Colors.accentWarning} />}
            title="Merge Conflicts"
            isToggle
            toggleValue={settings.notifications.mergeConflicts}
            onToggle={(val) =>
              updateSettings({
                notifications: {
                  ...settings.notifications,
                  mergeConflicts: val,
                },
              })
            }
          />
          <SettingsRow
            icon={<Bell size={18} color={Colors.textMuted} />}
            title="Background Tasks"
            isToggle
            toggleValue={settings.notifications.backgroundTasks}
            onToggle={(val) =>
              updateSettings({
                notifications: {
                  ...settings.notifications,
                  backgroundTasks: val,
                },
              })
            }
          />
          <SettingsRow
            icon={<Bell size={18} color={Colors.accentInfo} />}
            title="P2P Transfers"
            isToggle
            toggleValue={settings.notifications.p2pTransfers}
            onToggle={(val) =>
              updateSettings({
                notifications: { ...settings.notifications, p2pTransfers: val },
              })
            }
            isLast
          />
        </SettingsSection>

        <SettingsSection title="Appearance">
          <SettingsRow
            icon={<Palette size={18} color={Colors.accentPrimary} />}
            title="Theme"
            value="Dark"
          />
          <SettingsRow
            icon={<Type size={18} color={Colors.accentPrimary} />}
            title="Code Font Size"
            value={`${settings.codeFontSize}px`}
            onPress={() => {
              const newSize =
                settings.codeFontSize >= 18 ? 10 : settings.codeFontSize + 1;
              updateSettings({ codeFontSize: newSize });
            }}
            isLast
          />
        </SettingsSection>

        <SettingsSection title="Storage">
          <SettingsRow
            icon={<HardDrive size={18} color={Colors.accentPrimary} />}
            title="Storage Used"
            value="1.2 GB"
          />
          <SettingsRow
            icon={<Trash2 size={18} color={Colors.accentDanger} />}
            title="Clear Cache"
            value="45 MB"
            onPress={handleClearCache}
            danger
          />
          <SettingsRow
            icon={<Download size={18} color={Colors.accentPrimary} />}
            title="Export All"
            onPress={() => showToast("info", "Export started")}
            isLast
          />
        </SettingsSection>

        <SettingsSection title="P2P">
          <SettingsRow
            icon={<Wifi size={18} color={Colors.accentPrimary} />}
            title="Default Method"
            value="Wi-Fi Direct"
          />
          <SettingsRow
            icon={<Shield size={18} color={Colors.accentPrimary} />}
            title="Auto-accept Known Devices"
            isToggle
            toggleValue={settings.autoAcceptKnown}
            onToggle={(val) => updateSettings({ autoAcceptKnown: val })}
          />
          <SettingsRow
            icon={<Eye size={18} color={Colors.accentPrimary} />}
            title="Discovery Visibility"
            isToggle
            toggleValue={settings.discoveryVisible}
            onToggle={(val) => updateSettings({ discoveryVisible: val })}
            isLast
          />
        </SettingsSection>

        <SettingsSection title="Advanced">
          <SettingsRow
            icon={<RefreshCw size={18} color={Colors.accentPrimary} />}
            title="Enable Reflog"
            isToggle
            toggleValue={settings.enableReflog}
            onToggle={(val) => updateSettings({ enableReflog: val })}
          />
          <SettingsRow
            icon={<Trash2 size={18} color={Colors.accentPrimary} />}
            title="Garbage Collection"
            onPress={() => showToast("success", "GC completed")}
          />
          <SettingsRow
            icon={<HeartPulse size={18} color={Colors.accentPrimary} />}
            title="Repository Health"
            onPress={() => showToast("success", "All repos healthy")}
          />
          <SettingsRow
            icon={<FileText size={18} color={Colors.textSecondary} />}
            title="View Crash Logs"
            onPress={() => {}}
            isLast
          />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsRow
            icon={<Info size={18} color={Colors.textSecondary} />}
            title="Version"
            value="1.0.0"
          />
          <SettingsRow title="Build" value="20260221" />
          <SettingsRow
            icon={<FileCheck size={18} color={Colors.textSecondary} />}
            title="Open Source Licenses"
            onPress={() => {}}
          />
          <SettingsRow title="Privacy Policy" onPress={() => {}} />
          <SettingsRow title="Terms of Service" onPress={() => {}} isLast />
        </SettingsSection>

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={editModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEditModal(null)}>
                <X size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editModal === "name"
                  ? "Edit Name"
                  : editModal === "email"
                    ? "Edit Email"
                    : editModal === "github"
                      ? "GitHub Access Token"
                      : "GitHub Client ID"}
              </Text>
              <TouchableOpacity onPress={saveEdit}>
                <Check size={22} color={Colors.accentPrimary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              value={editValue}
              onChangeText={setEditValue}
              placeholder={
                editModal === "name"
                  ? "Your name"
                  : editModal === "email"
                    ? "your@email.com"
                    : editModal === "github"
                      ? "ghp_xxx..."
                      : "Iv1.XXXXX"
              }
              placeholderTextColor={Colors.textMuted}
              autoFocus
              keyboardType={editModal === "email" ? "email-address" : "default"}
              autoCapitalize={editModal === "email" ? "none" : "none"}
            />
            <Text style={styles.modalHelper}>
              {editModal === "github"
                ? "Used for cloning and pushing to GitHub"
                : "Used for all commits from this device"}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deviceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeviceModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setDeviceModalVisible(false)}>
                <X size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>GitHub Device Code</Text>
              <View style={{ width: 22 }} />
            </View>
            <Text style={styles.deviceCode}>{deviceUserCode || "—"}</Text>
            <View style={styles.deviceActions}>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: Colors.bgTertiary,
                    borderColor: Colors.borderDefault,
                  },
                ]}
                onPress={async () => {
                  if (!deviceUserCode) return;
                  await Clipboard.setStringAsync(deviceUserCode);
                  showToast("success", "Code copied");
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.actionText}>Copy Code</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtnPrimary]}
                onPress={async () => {
                  if (!deviceVerificationUrl) return;
                  await openVerificationUrl(deviceVerificationUrl);
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.actionText, { color: "#fff" }]}>
                  {devicePolling ? "Verifying…" : "Open GitHub"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text
              style={[
                styles.modalHelper,
                { textAlign: "center", marginTop: Spacing.sm },
              ]}
            >
              {deviceStatus === "waiting" && "Waiting for approval…"}
              {deviceStatus === "verified" && "Verified!"}
              {deviceStatus === "error" && "Verification failed"}
            </Text>
            <Text style={styles.modalHelper}>
              Enter the code on GitHub and return to the app.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  header: {
    height: 60,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderDefault,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalContent: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
  },
  modalInput: {
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.sm,
    height: 52,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    marginBottom: Spacing.sm,
  },
  modalHelper: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  deviceCode: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: 2,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    textAlign: "center",
  },
  deviceActions: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.md,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnPrimary: {
    flex: 1,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentPrimary,
  },
  actionText: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
  },
});
