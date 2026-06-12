import { gitEngine } from "@/services/git/engine";
import { expoFS } from "@/services/git/expo-fs";
import isogit from "isomorphic-git";
import GraphScreen from "@/app/(tabs)/graph";
import SegmentedControl from "@/components/SegmentedControl";
import StatusBadge from "@/components/StatusBadge";
import Colors from "@/constants/colors";
import { Radius, Spacing } from "@/constants/theme";
import { useGit } from "@/contexts/GitContext";
import { getAuthorColor, getAuthorInitials } from "@/mocks/repositories";
import type { GitCommit as GitCommitType, GitFile } from "@/types/git";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileCode2,
  FileJson,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  FolderTree,
  GitBranch,
  Link,
  MoreVertical,
  Plus,
  Send,
  Shield,
  Square,
  Trash2,
  Pencil,
  X as XIcon,
} from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  Dimensions,
  Linking,
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

const fileIconMap: Record<string, { Icon: typeof FileCode2; color: string }> = {
  tsx: { Icon: FileCode2, color: "#3B82F6" },
  ts: { Icon: FileCode2, color: "#3B82F6" },
  js: { Icon: FileCode2, color: "#EAB308" },
  jsx: { Icon: FileCode2, color: "#EAB308" },
  json: { Icon: FileJson, color: "#F97316" },
  md: { Icon: FileText, color: "#A3A3A3" },
};

function getFileIconComponent(ext?: string) {
  return fileIconMap[ext ?? ""] ?? { Icon: File, color: "#A3A3A3" };
}

function FileRow({
  file,
  onPress,
  onLongPress,
}: {
  file: GitFile;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { Icon, color } = file.isDirectory
    ? { Icon: Folder, color: Colors.accentWarning }
    : getFileIconComponent(file.extension);

  return (
    <TouchableOpacity
      style={styles.fileRow}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.6}
    >
      <Icon size={20} color={color} />
      <View style={styles.fileContent}>
        <Text style={styles.fileName}>{file.name}</Text>
        {!file.isDirectory && file.modifiedAt && (
          <Text style={styles.fileMeta}>
            {file.size ? `${(file.size / 1024).toFixed(1)}KB` : ""} ·{" "}
            {file.modifiedAt}
          </Text>
        )}
      </View>
      {file.status === "modified" && (
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: Colors.statusModified },
          ]}
        />
      )}
      {file.status === "untracked" && (
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: Colors.statusUntracked },
          ]}
        />
      )}
      {file.isDirectory && <ChevronRight size={16} color={Colors.textMuted} />}
    </TouchableOpacity>
  );
}

function ChangeFileRow({
  file,
  staged,
  onToggle,
}: {
  file: GitFile;
  staged: boolean;
  onToggle: () => void;
}) {
  const { Icon, color } = getFileIconComponent(file.extension);

  return (
    <TouchableOpacity
      style={styles.changeRow}
      onPress={onToggle}
      activeOpacity={0.6}
    >
      {staged ? (
        <CheckSquare size={20} color={Colors.accentPrimary} />
      ) : (
        <Square size={20} color={Colors.borderDefault} />
      )}
      <Icon size={18} color={color} />
      <View style={styles.changeContent}>
        <Text
          style={[styles.fileName, staged && { color: Colors.accentPrimary }]}
        >
          {file.name}
        </Text>
        <Text style={styles.fileMeta}>{file.path}</Text>
      </View>
      {file.changeType && <StatusBadge type={file.changeType} />}
    </TouchableOpacity>
  );
}

function CommitRow({
  commit,
  onPress,
}: {
  commit: GitCommitType;
  onPress: () => void;
}) {
  const authorColor = getAuthorColor(commit.author);
  const initials = getAuthorInitials(commit.author);

  return (
    <TouchableOpacity
      style={styles.commitRow}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={[styles.authorAvatar, { backgroundColor: authorColor }]}>
        <Text style={styles.authorInitials}>{initials}</Text>
      </View>
      <View style={styles.commitContent}>
        <Text style={styles.commitMessage} numberOfLines={1}>
          {commit.message}
        </Text>
        <Text style={styles.commitMeta}>
          {commit.author} · {commit.date}
        </Text>
        <View style={styles.commitTags}>
          {commit.branches
            .filter((b) => b !== "HEAD")
            .map((branch) => (
              <View key={branch} style={styles.commitBranchTag}>
                <GitBranch size={9} color={Colors.accentPrimary} />
                <Text style={styles.commitBranchText}>{branch}</Text>
              </View>
            ))}
          <Text style={styles.shaLabel}>{commit.shortSha}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function flattenFiles(files: GitFile[]): GitFile[] {
  const result: GitFile[] = [];
  for (const file of files) {
    if (file.isDirectory && file.children) {
      result.push(...flattenFiles(file.children));
    } else if (file.status) {
      result.push(file);
    }
  }
  return result;
}

/** Recursive tree node renderer for the sidebar */
function TreeNodeList({
  nodes,
  level,
  onFilePress,
}: {
  nodes: GitFile[];
  level: number;
  onFilePress: (file: GitFile) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () =>
      [...nodes].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      }),
    [nodes],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {sorted.map((node) => {
        const isOpen = expanded.has(node.id);
        const { Icon, color } = node.isDirectory
          ? { Icon: Folder, color: Colors.accentWarning }
          : getFileIconComponent(node.extension);

        return (
          <React.Fragment key={node.id}>
            <TouchableOpacity
              style={[styles.treeRow, { paddingLeft: 16 + level * 16 }]}
              activeOpacity={0.6}
              onPress={() => {
                if (node.isDirectory) toggle(node.id);
                else onFilePress(node);
              }}
            >
              {node.isDirectory && (
                <ChevronRight
                  size={14}
                  color={Colors.textMuted}
                  style={isOpen ? { transform: [{ rotate: '90deg' }] } : undefined}
                />
              )}
              <Icon size={16} color={color} />
              <Text style={styles.treeNodeText} numberOfLines={1}>
                {node.name}
              </Text>
              {node.status === 'modified' && (
                <View style={[styles.statusIndicator, { backgroundColor: Colors.statusModified }]} />
              )}
              {node.status === 'untracked' && (
                <View style={[styles.statusIndicator, { backgroundColor: Colors.statusUntracked }]} />
              )}
            </TouchableOpacity>
            {node.isDirectory && isOpen && node.children && (
              <TreeNodeList nodes={node.children} level={level + 1} onFilePress={onFilePress} />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default function RepositoryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    repositories,
    files,
    commits,
    selectedRepo,
    commitChanges,
    setSelectedRepoId,
    switchBranch,
    createBranch,
    deleteBranch,
    renameBranch,
    stageFile,
    unstageFile,
    pushSelectedRepo,
    pullSelectedRepo,
    createFile,
    deleteFile,
    addRemote,
    getRemotes,
    showToast,
  } = useGit();

  const repo = repositories.find((r) => r.id === id);
  const [tabIndex, setTabIndex] = useState(0);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [stagedFileIds, setStagedFileIds] = useState<Set<string>>(new Set());
  const [historySubIndex, setHistorySubIndex] = useState(0);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showPushBranchPicker, setShowPushBranchPicker] = useState(false);
  const [showPullBranchPicker, setShowPullBranchPicker] = useState(false);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<GitFile | null>(
    null,
  );
  const [showRenameBranch, setShowRenameBranch] = useState(false);
  const [renameOldBranchName, setRenameOldBranchName] = useState("");
  const [renameNewBranchName, setRenameNewBranchName] = useState("");
  const [isFileOpInProgress, setIsFileOpInProgress] = useState(false);
  const [showTreeSidebar, setShowTreeSidebar] = useState(false);
  const treeSidebarAnim = useRef(new Animated.Value(-Dimensions.get('window').width * 0.8)).current;

  useEffect(() => {
    if (id && selectedRepo?.id !== id) {
      setSelectedRepoId(id);
    }
  }, [id, selectedRepo?.id, setSelectedRepoId]);

  const currentFiles = useMemo(() => {
    let current = files;
    for (const segment of currentPath) {
      const dir = current.find((f) => f.name === segment && f.isDirectory);
      if (dir?.children) {
        current = dir.children;
      }
    }
    return [...current].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [files, currentPath]);

  const changedFiles = useMemo(() => flattenFiles(files), [files]);
  const unstagedFiles = changedFiles.filter((f) => !stagedFileIds.has(f.id));
  const stagedFiles = changedFiles.filter((f) => stagedFileIds.has(f.id));

  useEffect(() => {
    const stagedFromStatus = new Set(
      changedFiles.filter((f) => f.status === "staged").map((f) => f.id),
    );
    if (stagedFromStatus.size > 0) {
      setStagedFileIds(stagedFromStatus);
    }
  }, [changedFiles]);

  const toggleStage = useCallback(
    async (file: GitFile) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const fileKey = file.path.replace(/^\//, "");
      const shouldStage = !stagedFileIds.has(file.id);

      if (shouldStage) {
        await stageFile(fileKey);
      } else {
        await unstageFile(fileKey);
      }

      setStagedFileIds((prev) => {
        const next = new Set(prev);
        if (shouldStage) {
          next.add(file.id);
        } else {
          next.delete(file.id);
        }
        return next;
      });
    },
    [stageFile, unstageFile, stagedFileIds],
  );

  const handleCommit = useCallback(() => {
    if (stagedFiles.length === 0 || !commitMessage.trim()) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    commitChanges(commitMessage.trim());
    setCommitMessage("");
    setStagedFileIds(new Set());
  }, [stagedFiles.length, commitMessage, commitChanges]);

  const handleCreateBranch = useCallback(async () => {
    if (!repo || !newBranchName.trim()) return;
    try {
      await createBranch(repo.id, newBranchName.trim());
      setNewBranchName("");
      setShowCreateBranch(false);
      setShowBranchSelector(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create branch";
      showToast("error", msg);
    }
  }, [repo, newBranchName, createBranch, showToast]);

  const handleDeleteBranch = useCallback((branchName: string) => {
    if (!repo) return;
    if (branchName === repo.currentBranch) {
      showToast("error", "Cannot delete the active checkout branch.");
      return;
    }
    Alert.alert(
      "Delete Branch",
      `Are you sure you want to delete branch "${branchName}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteBranch(repo.id, branchName);
            } catch (err: any) {
              showToast("error", err?.message ?? "Failed to delete branch");
            }
          },
        },
      ]
    );
  }, [repo, deleteBranch, showToast]);

  const handleRenameBranch = useCallback(async () => {
    if (!repo || !renameNewBranchName.trim() || !renameOldBranchName) return;
    try {
      await renameBranch(repo.id, renameOldBranchName, renameNewBranchName.trim());
      setShowRenameBranch(false);
      setRenameOldBranchName("");
      setRenameNewBranchName("");
    } catch (err: any) {
      showToast("error", err?.message ?? "Failed to rename branch");
    }
  }, [repo, renameOldBranchName, renameNewBranchName, renameBranch, showToast]);

  const handlePushToBranch = useCallback(
    (branchName: string) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setShowPushBranchPicker(false);
      pushSelectedRepo(branchName);
    },
    [pushSelectedRepo],
  );

  const handlePullFromBranch = useCallback(
    (branchName: string) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setShowPullBranchPicker(false);
      pullSelectedRepo(branchName);
    },
    [pullSelectedRepo],
  );

  const handleCreateFile = useCallback(async () => {
    if (!newFileName.trim() || isFileOpInProgress) return;
    setIsFileOpInProgress(true);
    const basePath = currentPath.length > 0 ? currentPath.join("/") + "/" : "";
    const fullPath = basePath + newFileName.trim();
    try {
      if (isCreatingFolder) {
        await createFile(fullPath + "/.gitkeep", "");
      } else {
        await createFile(fullPath, newFileContent);
      }
      setNewFileName("");
      setNewFileContent("");
      setShowNewFileModal(false);
      setIsCreatingFolder(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create file";
      showToast("error", msg);
    } finally {
      setIsFileOpInProgress(false);
    }
  }, [
    newFileName,
    newFileContent,
    currentPath,
    isCreatingFolder,
    isFileOpInProgress,
    createFile,
    showToast,
  ]);

  const openTreeSidebar = useCallback(() => {
    setShowTreeSidebar(true);
    Animated.spring(treeSidebarAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, [treeSidebarAnim]);

  const closeTreeSidebar = useCallback(() => {
    Animated.timing(treeSidebarAnim, {
      toValue: -Dimensions.get('window').width * 0.8,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setShowTreeSidebar(false));
  }, [treeSidebarAnim]);

  const handleDeleteFile = useCallback(
    async (file: GitFile) => {
      if (isFileOpInProgress) return;
      setIsFileOpInProgress(true);
      const filePath = file.path.replace(/^\//, "");
      try {
        await deleteFile(filePath);
        setShowDeleteConfirm(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to delete file";
        showToast("error", msg);
      } finally {
        setIsFileOpInProgress(false);
      }
    },
    [deleteFile, showToast, isFileOpInProgress],
  );

  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [currentOriginUrl, setCurrentOriginUrl] = useState<string | null>(null);

  const handleSetRemote = useCallback(async () => {
    if (!repo) return;
    // Check current remotes
    let currentRemotes: { remote: string; url: string }[] = [];
    try {
      currentRemotes = await getRemotes(repo.id);
    } catch {}
    const currentOrigin = currentRemotes.find((r) => r.remote === "origin");
    setCurrentOriginUrl(currentOrigin?.url ?? null);
    setRemoteUrl(currentOrigin?.url ?? "");
    setShowRemoteModal(true);
  }, [repo, getRemotes]);

  const saveRemote = useCallback(async () => {
    if (!repo || !remoteUrl.trim()) return;
    try {
      await addRemote(repo.id, "origin", remoteUrl.trim());
      setShowRemoteModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set remote";
      showToast("error", msg);
    }
  }, [repo, remoteUrl, addRemote, showToast]);

  const handleMenuPress = useCallback(() => {
    Alert.alert(repo?.name ?? "Repository", undefined, [
      {
        text: "Set Remote (origin)",
        onPress: handleSetRemote,
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [repo, handleSetRemote]);

  if (!repo) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>Repository not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {repo.name}
          </Text>
          <TouchableOpacity
            style={styles.branchBtn}
            onPress={() => setShowBranchSelector(!showBranchSelector)}
          >
            <GitBranch size={12} color={Colors.accentPrimary} />
            <Text style={styles.branchBtnText}>{repo.currentBranch}</Text>
            <ChevronDown size={12} color={Colors.accentPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.pullBtn}
            onPress={() => setShowPullBranchPicker(!showPullBranchPicker)}
            activeOpacity={0.7}
          >
            <Download size={16} color={Colors.accentPrimary} />
            <Text style={styles.pushText}>Pull</Text>
            <ChevronDown size={10} color={Colors.accentPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.pushBtn}
            onPress={() => setShowPushBranchPicker(!showPushBranchPicker)}
            activeOpacity={0.7}
          >
            <Send size={16} color={Colors.accentPrimary} />
            <Text style={styles.pushText}>Push</Text>
            <ChevronDown size={10} color={Colors.accentPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuBtn} onPress={handleMenuPress}>
            <MoreVertical size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {showPushBranchPicker && (
        <View style={styles.branchDropdown}>
          <Text style={styles.dropdownLabel}>Push to branch:</Text>
          {repo.branches.map((branch) => (
            <TouchableOpacity
              key={branch.name}
              style={[
                styles.branchItem,
                branch.isCurrent && styles.branchItemActive,
              ]}
              onPress={() => handlePushToBranch(branch.name)}
            >
              <GitBranch
                size={14}
                color={
                  branch.isCurrent ? Colors.accentPrimary : Colors.textMuted
                }
              />
              <Text
                style={[
                  styles.branchItemText,
                  branch.isCurrent && styles.branchItemTextActive,
                ]}
              >
                {branch.name}
              </Text>
              {branch.isCurrent && <Text style={styles.headLabel}>HEAD</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showPullBranchPicker && (
        <View style={styles.branchDropdown}>
          <Text style={styles.dropdownLabel}>Pull from branch:</Text>
          {repo.branches.map((branch) => (
            <TouchableOpacity
              key={branch.name}
              style={[
                styles.branchItem,
                branch.isCurrent && styles.branchItemActive,
              ]}
              onPress={() => handlePullFromBranch(branch.name)}
            >
              <GitBranch
                size={14}
                color={
                  branch.isCurrent ? Colors.accentPrimary : Colors.textMuted
                }
              />
              <Text
                style={[
                  styles.branchItemText,
                  branch.isCurrent && styles.branchItemTextActive,
                ]}
              >
                {branch.name}
              </Text>
              {branch.isCurrent && <Text style={styles.headLabel}>HEAD</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showBranchSelector && (
        <View style={styles.branchDropdown}>
          {repo.branches.map((branch) => (
            <View
              key={branch.name}
              style={[
                styles.branchItem,
                branch.isCurrent && styles.branchItemActive,
                { justifyContent: 'space-between' }
              ]}
            >
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                onPress={() => {
                  switchBranch(repo.id, branch.name);
                  setShowBranchSelector(false);
                }}
              >
                <GitBranch
                  size={14}
                  color={
                    branch.isCurrent ? Colors.accentPrimary : Colors.textMuted
                  }
                />
                <Text
                  style={[
                    styles.branchItemText,
                    branch.isCurrent && styles.branchItemTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {branch.name}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {branch.isCurrent ? (
                  <Text style={styles.headLabel}>HEAD</Text>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={() => {
                        setRenameOldBranchName(branch.name);
                        setRenameNewBranchName(branch.name);
                        setShowRenameBranch(true);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Pencil size={14} color={Colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteBranch(branch.name)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Trash2 size={14} color={Colors.accentDanger} />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={styles.branchItem}
            onPress={() => setShowCreateBranch(true)}
          >
            <Plus size={14} color={Colors.accentPrimary} />
            <Text
              style={[styles.branchItemText, { color: Colors.accentPrimary }]}
            >
              Create new branch
            </Text>
          </TouchableOpacity>
          {showCreateBranch && (
            <View style={styles.createBranchRow}>
              <TextInput
                style={styles.createBranchInput}
                placeholder="Branch name..."
                placeholderTextColor={Colors.textMuted}
                value={newBranchName}
                onChangeText={setNewBranchName}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onSubmitEditing={handleCreateBranch}
              />
              <TouchableOpacity
                style={[
                  styles.createBranchBtn,
                  !newBranchName.trim() && { opacity: 0.4 },
                ]}
                onPress={handleCreateBranch}
                disabled={!newBranchName.trim()}
              >
                <Text style={styles.createBranchBtnText}>Create</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <View style={styles.segmentWrap}>
        <SegmentedControl
          segments={["Files", "Changes", "History", "Terminal"]}
          selectedIndex={tabIndex}
          onChange={setTabIndex}
        />
      </View>

      {tabIndex === 0 && (
        <View style={styles.tabContent}>
        <ScrollView
          showsVerticalScrollIndicator={false}
        >
          {/* File toolbar */}
          <View style={styles.fileToolbar}>
            <TouchableOpacity
              style={styles.fileToolbarBtn}
              onPress={() => {
                setIsCreatingFolder(false);
                setShowNewFileModal(true);
              }}
            >
              <FilePlus2 size={16} color={Colors.accentPrimary} />
              <Text style={styles.fileToolbarBtnText}>New File</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fileToolbarBtn}
              onPress={() => {
                setIsCreatingFolder(true);
                setShowNewFileModal(true);
              }}
            >
              <FolderPlus size={16} color={Colors.accentWarning} />
              <Text style={styles.fileToolbarBtnText}>New Folder</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fileToolbarBtn}
              onPress={openTreeSidebar}
            >
              <FolderTree size={16} color={Colors.accentPurple} />
              <Text style={styles.fileToolbarBtnText}>Tree</Text>
            </TouchableOpacity>
          </View>

          {currentPath.length > 0 && (
            <View style={styles.breadcrumb}>
              <TouchableOpacity onPress={() => setCurrentPath([])}>
                <Text style={styles.breadcrumbText}>Root</Text>
              </TouchableOpacity>
              {currentPath.map((segment, i) => (
                <React.Fragment key={segment}>
                  <ChevronRight size={14} color={Colors.textMuted} />
                  <TouchableOpacity
                    onPress={() => setCurrentPath(currentPath.slice(0, i + 1))}
                  >
                    <Text
                      style={[
                        styles.breadcrumbText,
                        i === currentPath.length - 1 && styles.breadcrumbActive,
                      ]}
                    >
                      {segment}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          )}
          {currentFiles.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              onPress={() => {
                if (file.isDirectory) {
                  setCurrentPath([...currentPath, file.name]);
                } else {
                  router.push({
                    pathname: "/file-viewer",
                    params: {
                      name: file.name,
                      content: file.content ?? "",
                      ext: file.extension ?? "",
                      filePath: file.path,
                    },
                  });
                }
              }}
              onLongPress={() => setShowDeleteConfirm(file)}
            />
          ))}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Security Scan FAB */}
        <TouchableOpacity
          style={styles.securityFab}
          activeOpacity={0.8}
          onPress={() => Linking.openURL('https://spectra-guard.vercel.app/dashboard')}
        >
          <Shield size={22} color="#fff" />
          <Text style={styles.securityFabText}>Scan</Text>
        </TouchableOpacity>

        {/* Tree Sidebar */}
        {showTreeSidebar && (
          <View style={StyleSheet.absoluteFill}>
            <TouchableOpacity
              style={styles.treeSidebarOverlay}
              activeOpacity={1}
              onPress={closeTreeSidebar}
            />
            <Animated.View
              style={[
                styles.treeSidebarContainer,
                { transform: [{ translateX: treeSidebarAnim }] },
              ]}
            >
              <View style={styles.treeSidebarHeader}>
                <FolderTree size={18} color={Colors.accentPurple} />
                <Text style={styles.treeSidebarTitle}>Directory Tree</Text>
                <TouchableOpacity onPress={closeTreeSidebar} style={styles.treeSidebarCloseBtn}>
                  <XIcon size={20} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.treeSidebarScroll} showsVerticalScrollIndicator={false}>
                <TreeNodeList nodes={files} level={0} onFilePress={(file) => {
                  closeTreeSidebar();
                  if (file.isDirectory) {
                    const pathSegments = file.path.replace(/^\//, '').split('/');
                    setCurrentPath(pathSegments);
                  } else {
                    router.push({
                      pathname: '/file-viewer',
                      params: {
                        name: file.name,
                        content: file.content ?? '',
                        ext: file.extension ?? '',
                        filePath: file.path,
                      },
                    });
                  }
                }} />
                <View style={{ height: 40 }} />
              </ScrollView>
            </Animated.View>
          </View>
        )}
        </View>
      )}

      {/* Create File / Folder Modal */}
      <Modal
        visible={showNewFileModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewFileModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {isCreatingFolder ? "New Folder" : "New File"}
            </Text>
            <Text style={styles.modalSubtitle}>
              {currentPath.length > 0
                ? `In: /${currentPath.join("/")}/`
                : "In: / (root)"}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder={isCreatingFolder ? "folder-name" : "filename.tsx"}
              placeholderTextColor={Colors.textMuted}
              value={newFileName}
              onChangeText={setNewFileName}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {!isCreatingFolder && (
              <TextInput
                style={[
                  styles.modalInput,
                  { minHeight: 80, textAlignVertical: "top" },
                ]}
                placeholder="File content (optional)"
                placeholderTextColor={Colors.textMuted}
                value={newFileContent}
                onChangeText={setNewFileContent}
                multiline
                numberOfLines={4}
              />
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowNewFileModal(false);
                  setNewFileName("");
                  setNewFileContent("");
                  setIsCreatingFolder(false);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSaveBtn,
                  (!newFileName.trim() || isFileOpInProgress) && {
                    opacity: 0.4,
                  },
                ]}
                onPress={handleCreateFile}
                disabled={!newFileName.trim() || isFileOpInProgress}
              >
                {isCreatingFolder ? (
                  <FolderPlus size={14} color="#fff" />
                ) : (
                  <FilePlus2 size={14} color="#fff" />
                )}
                <Text style={styles.modalSaveText}>
                  {isFileOpInProgress ? "Creating..." : "Create"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={!!showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Delete {showDeleteConfirm?.isDirectory ? "Folder" : "File"}
            </Text>
            <Text style={styles.deleteConfirmText}>
              Are you sure you want to delete{" "}
              <Text style={{ fontWeight: "700", color: Colors.textPrimary }}>
                {showDeleteConfirm?.name}
              </Text>
              ? This action cannot be undone.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDeleteConfirm(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.deleteConfirmBtn,
                  isFileOpInProgress && { opacity: 0.4 },
                ]}
                onPress={() =>
                  showDeleteConfirm && handleDeleteFile(showDeleteConfirm)
                }
                disabled={isFileOpInProgress}
              >
                <Trash2 size={14} color="#fff" />
                <Text style={styles.modalSaveText}>
                  {isFileOpInProgress ? "Deleting..." : "Delete"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename Branch Modal */}
      <Modal
        visible={showRenameBranch}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRenameBranch(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename Branch</Text>
            <Text style={styles.modalSubtitle}>
              Rename branch "{renameOldBranchName}" to:
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="new-branch-name"
              placeholderTextColor={Colors.textMuted}
              value={renameNewBranchName}
              onChangeText={setRenameNewBranchName}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={handleRenameBranch}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowRenameBranch(false);
                  setRenameOldBranchName("");
                  setRenameNewBranchName("");
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSaveBtn,
                  !renameNewBranchName.trim() && { opacity: 0.4 },
                ]}
                onPress={handleRenameBranch}
                disabled={!renameNewBranchName.trim()}
              >
                <Check size={14} color="#fff" />
                <Text style={styles.modalSaveText}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {tabIndex === 1 && (
        <View style={styles.tabContent}>
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            {unstagedFiles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Changes</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{unstagedFiles.length}</Text>
                  </View>
                </View>
                {unstagedFiles.map((file) => (
                  <ChangeFileRow
                    key={file.id}
                    file={file}
                    staged={false}
                    onToggle={() => toggleStage(file)}
                  />
                ))}
              </>
            )}

            {stagedFiles.length > 0 && (
              <>
                <View
                  style={[
                    styles.sectionHeader,
                    {
                      borderTopWidth: 1,
                      borderTopColor: Colors.borderMuted,
                      marginTop: Spacing.sm,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: Colors.accentPrimary },
                    ]}
                  >
                    Staged for Commit
                  </Text>
                  <View
                    style={[
                      styles.countBadge,
                      { backgroundColor: Colors.accentPrimaryDim },
                    ]}
                  >
                    <Text
                      style={[
                        styles.countText,
                        { color: Colors.accentPrimary },
                      ]}
                    >
                      {stagedFiles.length}
                    </Text>
                  </View>
                </View>
                {stagedFiles.map((file) => (
                  <ChangeFileRow
                    key={file.id}
                    file={file}
                    staged
                    onToggle={() => toggleStage(file)}
                  />
                ))}
              </>
            )}
            <View style={{ height: 180 }} />
          </ScrollView>

          <View style={styles.commitComposer}>
            <TextInput
              style={styles.commitInput}
              placeholder="Describe your changes..."
              placeholderTextColor={Colors.textMuted}
              value={commitMessage}
              onChangeText={setCommitMessage}
              multiline
              maxLength={200}
              numberOfLines={3}
            />
            <View style={styles.commitFooter}>
              <Text style={styles.charCount}>{commitMessage.length}/200</Text>
              <TouchableOpacity
                style={[
                  styles.commitBtn,
                  (stagedFiles.length === 0 || !commitMessage.trim()) &&
                    styles.commitBtnDisabled,
                ]}
                onPress={handleCommit}
                disabled={stagedFiles.length === 0 || !commitMessage.trim()}
              >
                <Send
                  size={16}
                  color={
                    stagedFiles.length > 0 && commitMessage.trim()
                      ? "#FFFFFF"
                      : Colors.textMuted
                  }
                />
                <Text
                  style={[
                    styles.commitBtnText,
                    (stagedFiles.length === 0 || !commitMessage.trim()) &&
                      styles.commitBtnTextDisabled,
                  ]}
                >
                  Commit{" "}
                  {stagedFiles.length > 0 ? `${stagedFiles.length} files` : ""}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {tabIndex === 2 && (
        <View style={styles.tabContent}>
          <View style={styles.segmentWrap}>
            <SegmentedControl
              segments={["Commits", "Graph"]}
              selectedIndex={historySubIndex}
              onChange={setHistorySubIndex}
            />
          </View>
          {historySubIndex === 0 ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              {commits.map((commit) => (
                <CommitRow
                  key={commit.sha}
                  commit={commit}
                  onPress={() => {
                    router.push({
                      pathname: "/commit-detail",
                      params: { sha: commit.sha },
                    });
                  }}
                />
              ))}
              <View style={{ height: 100 }} />
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>
              <GraphScreen />
            </View>
          )}
        </View>
      )}

      {tabIndex === 3 && (
        <View style={styles.tabContent}>
          <View style={styles.terminalHeader}>
            <Text style={styles.terminalTitle}>Terminal</Text>
          </View>
          <TerminalPanel />
        </View>
      )}

      {/* Set Remote Modal */}
      <Modal
        visible={showRemoteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRemoteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set Remote (origin)</Text>
            {currentOriginUrl && (
              <Text style={styles.modalSubtitle}>
                Current: {currentOriginUrl}
              </Text>
            )}
            <TextInput
              style={styles.modalInput}
              placeholder="https://github.com/user/repo.git"
              placeholderTextColor={Colors.textMuted}
              value={remoteUrl}
              onChangeText={setRemoteUrl}
              autoCapitalize="none"
              autoCorrect={false}
              selectTextOnFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowRemoteModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSaveBtn,
                  !remoteUrl.trim() && { opacity: 0.4 },
                ]}
                onPress={saveRemote}
                disabled={!remoteUrl.trim()}
              >
                <Link size={14} color="#fff" />
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Terminal helpers ──────────────────────────────────────────────────────────

/** Resolve a user-typed path to an absolute POSIX path inside the repo. */
function resolveTerminalPath(cwd: string, input: string): string {
  if (!input || input === ".") return cwd;
  const segments = input.startsWith("/")
    ? input.split("/").filter(Boolean)
    : [...cwd.split("/").filter(Boolean), ...input.split("/")];
  const out: string[] = [];
  for (const s of segments) {
    if (s === "..") out.pop();
    else if (s !== ".") out.push(s);
  }
  return "/" + out.join("/");
}

/** Turn an absolute POSIX path into a path relative to the repo root. */
function toRepoRelative(repoDir: string, abs: string): string {
  if (abs.startsWith(repoDir + "/")) return abs.slice(repoDir.length + 1);
  if (abs === repoDir) return ".";
  return abs; // already relative or outside – return as-is
}

// ── TerminalPanel component ───────────────────────────────────────────────────

interface TermLine {
  text: string;
  color?: string;
}

function TerminalPanel() {
  const {
    selectedRepo,
    settings,
    commitChanges,
    createBranch,
    switchBranch,
    mergeInto,
    showToast,
    pushSelectedRepo,
    pullSelectedRepo,
    addRemote,
    getRemotes,
  } = useGit();

  const repoDir = useMemo(
    () => (selectedRepo ? gitEngine.resolveRepoDir(selectedRepo.id) : null),
    [selectedRepo],
  );

  const [lines, setLines] = useState<TermLine[]>([
    {
      text: "GitLane Terminal — type 'help' for commands",
      color: Colors.accentPrimary,
    },
  ]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<ScrollView>(null);

  // Reset terminal when repo changes
  useEffect(() => {
    if (repoDir) {
      setCwd(repoDir);
      setLines([
        {
          text: `GitLane Terminal — ${selectedRepo?.name}`,
          color: Colors.accentPrimary,
        },
        { text: `root: ${repoDir}`, color: Colors.textMuted },
        { text: "type 'help' for available commands", color: Colors.textMuted },
      ]);
    }
  }, [repoDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll on new output
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [lines]);

  const push = useCallback(
    (text: string, color?: string) =>
      setLines((prev) => [...prev, { text, color }]),
    [],
  );

  const cwdDisplay = useMemo(() => {
    if (!cwd || !repoDir) return "~";
    return cwd === repoDir ? "~" : "~/" + cwd.slice(repoDir.length + 1);
  }, [cwd, repoDir]);

  const historyUp = useCallback(() => {
    setHistIdx((i) => {
      const next = Math.min(i + 1, cmdHistory.length - 1);
      setCmd(cmdHistory[next] ?? "");
      return next;
    });
  }, [cmdHistory]);

  const historyDown = useCallback(() => {
    setHistIdx((i) => {
      const next = Math.max(i - 1, -1);
      setCmd(next === -1 ? "" : (cmdHistory[next] ?? ""));
      return next;
    });
  }, [cmdHistory]);

  const run = useCallback(async () => {
    const input = cmd.trim();
    if (!input) return;

    const prompt = `${selectedRepo?.name ?? "repo"}:${cwdDisplay} $`;
    push(`${prompt} ${input}`, Colors.accentSecondary);
    setCmd("");
    setCmdHistory((h) => [input, ...h].slice(0, 100));
    setHistIdx(-1);

    if (!repoDir || !cwd) {
      push("Error: no repository selected.", Colors.accentDanger);
      return;
    }

    // Tokenise (respects "quoted strings")
    const tokens =
      input
        .match(/(?:"[^"]*"|'[^']*'|[^\s])+/g)
        ?.map((t) => t.replace(/^["']|["']$/g, "")) ?? [];
    const head = tokens[0]?.toLowerCase() ?? "";
    const args = tokens.slice(1);

    try {
      // ── built-ins ──────────────────────────────────────────────────
      if (head === "clear" || head === "cls") {
        setLines([]);
        return;
      }

      if (head === "help") {
        const helpLines = [
          "",
          "  Filesystem",
          "  ──────────────────────────────────────────",
          "  pwd                     print working directory",
          "  ls [path]               list directory contents",
          "  cd <path>               change directory  (cd ~ to go back to root)",
          "  cat <file>              print file contents",
          "  mkdir <dir>             create directory",
          "  touch <file>            create empty file",
          "  rm <file>               delete file",
          "  echo <text>             print text",
          "  clear                   clear screen",
          "",
          "  Git",
          "  ──────────────────────────────────────────",
          "  git status              show working-tree status",
          "  git add <path|.>        stage file(s)",
          "  git reset [HEAD] <path> unstage file",
          "  git commit -m <msg>     commit staged changes",
          "  git log [--oneline]     show commit history",
          "  git branch              list branches",
          "  git branch <name>       create branch",
          "  git checkout <branch>   switch branch",
          "  git checkout -b <name>  create + switch",
          "  git merge <branch>      merge branch into current",
          "  git diff                show unstaged changes",
          "  git remote -v           list remotes",
          "  git remote add <n> <u>  add remote",
          "  git push                push to origin",
          "  git pull                pull from origin",
          "",
        ];
        helpLines.forEach((l) =>
          push(
            l,
            l.startsWith("  git") ||
              l.startsWith("  pwd") ||
              l.startsWith("  ls") ||
              l.startsWith("  cd") ||
              l.startsWith("  cat") ||
              l.startsWith("  mkdir") ||
              l.startsWith("  touch") ||
              l.startsWith("  rm") ||
              l.startsWith("  echo") ||
              l.startsWith("  clear")
              ? Colors.textPrimary
              : Colors.textMuted,
          ),
        );
        return;
      }

      if (head === "pwd") {
        push(cwd);
        return;
      }

      if (head === "echo") {
        push(args.join(" "));
        return;
      }

      if (head === "ls" || head === "dir") {
        const target = args[0] ? resolveTerminalPath(cwd, args[0]) : cwd;
        const entries = await expoFS.promises.readdir(target);
        const visible = entries.filter((e) => e !== ".git");
        if (visible.length === 0) {
          push("(empty directory)", Colors.textMuted);
        } else {
          const labelled: string[] = [];
          for (const name of visible) {
            try {
              const s = await expoFS.promises.stat(`${target}/${name}`);
              labelled.push(s.isDirectory() ? name + "/" : name);
            } catch {
              labelled.push(name);
            }
          }
          push(labelled.join("    "));
        }
        return;
      }

      if (head === "cd") {
        const dest =
          args[0] === "~" || !args[0]
            ? repoDir
            : resolveTerminalPath(cwd, args[0]);
        if (!dest.startsWith(repoDir)) {
          push(
            "cd: cannot navigate above repository root",
            Colors.accentDanger,
          );
          return;
        }
        try {
          await expoFS.promises.readdir(dest); // throws if absent / not a dir
          setCwd(dest);
        } catch {
          push(`cd: no such directory: ${args[0]}`, Colors.accentDanger);
        }
        return;
      }

      if (head === "cat" || head === "type") {
        if (!args[0]) {
          push("Usage: cat <file>", Colors.accentDanger);
          return;
        }
        const target = resolveTerminalPath(cwd, args[0]);
        const content = (await expoFS.promises.readFile(
          target,
          "utf8",
        )) as string;
        content.split("\n").forEach((l) => push(l));
        return;
      }

      if (head === "mkdir") {
        if (!args[0]) {
          push("Usage: mkdir <dir>", Colors.accentDanger);
          return;
        }
        await expoFS.promises.mkdir(resolveTerminalPath(cwd, args[0]), {
          recursive: true,
        });
        push(`created directory: ${args[0]}`, Colors.accentPrimary);
        return;
      }

      if (head === "touch") {
        if (!args[0]) {
          push("Usage: touch <file>", Colors.accentDanger);
          return;
        }
        await expoFS.promises.writeFile(
          resolveTerminalPath(cwd, args[0]),
          "",
          "utf8",
        );
        push(`created: ${args[0]}`, Colors.accentPrimary);
        return;
      }

      if (head === "rm" || head === "del") {
        if (!args[0]) {
          push(`Usage: ${head} <file>`, Colors.accentDanger);
          return;
        }
        await expoFS.promises.unlink(resolveTerminalPath(cwd, args[0]));
        push(`deleted: ${args[0]}`, Colors.accentWarning);
        return;
      }

      // ── git ────────────────────────────────────────────────────────
      if (head === "git") {
        const sub = args[0]?.toLowerCase();
        const gitArgs = args.slice(1);

        if (!sub) {
          push("usage: git <command>", Colors.accentDanger);
          return;
        }

        switch (sub) {
          case "status": {
            const matrix = await isogit.statusMatrix({
              fs: expoFS,
              dir: repoDir,
            });
            const staged: string[] = [];
            const modified: string[] = [];
            const untracked: string[] = [];
            for (const [fp, head2, workdir, stage] of matrix) {
              if (fp.startsWith(".git")) continue;
              if (head2 === 0 && workdir === 2 && stage === 0)
                untracked.push(fp);
              else if (stage !== head2) staged.push(fp);
              else if (workdir !== head2) modified.push(fp);
            }
            const branch =
              (await isogit.currentBranch({
                fs: expoFS,
                dir: repoDir,
                fullname: false,
              })) ?? "HEAD";
            push(`On branch ${branch}`, Colors.accentPrimary);
            if (staged.length > 0) {
              push("Changes to be committed:", Colors.accentPrimary);
              staged.forEach((f) =>
                push(`\tstaged:    ${f}`, Colors.accentPrimary),
              );
            }
            if (modified.length > 0) {
              push("Changes not staged for commit:", Colors.accentWarning);
              modified.forEach((f) =>
                push(`\tmodified:  ${f}`, Colors.accentWarning),
              );
            }
            if (untracked.length > 0) {
              push("Untracked files:", Colors.textMuted);
              untracked.forEach((f) => push(`\t${f}`, Colors.textMuted));
            }
            if (
              staged.length === 0 &&
              modified.length === 0 &&
              untracked.length === 0
            ) {
              push(
                "nothing to commit, working tree clean",
                Colors.accentPrimary,
              );
            }
            break;
          }

          case "add": {
            const pathArg = gitArgs[0];
            if (!pathArg) {
              push("Usage: git add <path|.>", Colors.accentDanger);
              break;
            }
            if (pathArg === ".") {
              const matrix = await isogit.statusMatrix({
                fs: expoFS,
                dir: repoDir,
              });
              let count = 0;
              for (const [fp, head2, workdir] of matrix) {
                if (fp.startsWith(".git")) continue;
                if (workdir !== head2) {
                  await isogit.add({ fs: expoFS, dir: repoDir, filepath: fp });
                  count++;
                }
              }
              push(`staged ${count} file(s)`, Colors.accentPrimary);
            } else {
              const rel = toRepoRelative(
                repoDir,
                resolveTerminalPath(cwd, pathArg),
              );
              await isogit.add({ fs: expoFS, dir: repoDir, filepath: rel });
              push(`staged: ${rel}`, Colors.accentPrimary);
            }
            break;
          }

          case "reset": {
            const pathArg = gitArgs[0] === "HEAD" ? gitArgs[1] : gitArgs[0];
            if (!pathArg) {
              push("Usage: git reset <path>", Colors.accentDanger);
              break;
            }
            const rel = toRepoRelative(
              repoDir,
              resolveTerminalPath(cwd, pathArg),
            );
            await isogit.resetIndex({
              fs: expoFS,
              dir: repoDir,
              filepath: rel,
            });
            push(`unstaged: ${rel}`, Colors.accentWarning);
            break;
          }

          case "commit": {
            const mIdx = gitArgs.findIndex((a) => a === "-m");
            if (mIdx === -1 || !gitArgs[mIdx + 1]) {
              push("Usage: git commit -m <message>", Colors.accentDanger);
              break;
            }
            const msg = gitArgs.slice(mIdx + 1).join(" ");
            await commitChanges(msg);
            try {
              const oid = await isogit.resolveRef({
                fs: expoFS,
                dir: repoDir,
                ref: "HEAD",
              });
              push(
                `[${selectedRepo?.currentBranch ?? "main"} ${oid.slice(0, 7)}] ${msg}`,
                Colors.accentPrimary,
              );
            } catch {
              push(`committed: ${msg}`, Colors.accentPrimary);
            }
            break;
          }

          case "log": {
            const oneline = gitArgs.includes("--oneline");
            const commits = await isogit.log({
              fs: expoFS,
              dir: repoDir,
              depth: 30,
            });
            if (commits.length === 0) {
              push("(no commits yet)", Colors.textMuted);
              break;
            }
            for (const c of commits) {
              const sha = c.oid.slice(0, 7);
              const msg = c.commit.message.split("\n")[0];
              const date = new Date(
                c.commit.author.timestamp * 1000,
              ).toLocaleDateString();
              if (oneline) {
                push(`${sha} ${msg}`);
              } else {
                push(`commit ${c.oid}`, Colors.accentWarning);
                push(
                  `Author: ${c.commit.author.name} <${c.commit.author.email}>`,
                );
                push(`Date:   ${date}`);
                push(`\n    ${msg}\n`);
              }
            }
            break;
          }

          case "branch": {
            if (
              gitArgs.length === 0 ||
              gitArgs[0] === "-a" ||
              gitArgs[0] === "-v"
            ) {
              const branches = await isogit.listBranches({
                fs: expoFS,
                dir: repoDir,
              });
              const current = await isogit.currentBranch({
                fs: expoFS,
                dir: repoDir,
                fullname: false,
              });
              branches.forEach((b) =>
                push(
                  `${b === current ? "* " : "  "}${b}`,
                  b === current ? Colors.accentPrimary : undefined,
                ),
              );
            } else {
              await createBranch(selectedRepo!.id, gitArgs[0]);
              push(`branch '${gitArgs[0]}' created`, Colors.accentPrimary);
            }
            break;
          }

          case "checkout": {
            if (gitArgs[0] === "-b") {
              if (!gitArgs[1]) {
                push("Usage: git checkout -b <name>", Colors.accentDanger);
                break;
              }
              await createBranch(selectedRepo!.id, gitArgs[1]);
              push(
                `Switched to a new branch '${gitArgs[1]}'`,
                Colors.accentPrimary,
              );
            } else {
              if (!gitArgs[0]) {
                push("Usage: git checkout <branch>", Colors.accentDanger);
                break;
              }
              await switchBranch(selectedRepo!.id, gitArgs[0]);
              push(`Switched to branch '${gitArgs[0]}'`, Colors.accentPrimary);
            }
            break;
          }

          case "merge": {
            if (!gitArgs[0]) {
              push("Usage: git merge <branch>", Colors.accentDanger);
              break;
            }
            await mergeInto(selectedRepo!.id, gitArgs[0]);
            push(`Merged branch '${gitArgs[0]}'`, Colors.accentPrimary);
            break;
          }

          case "push": {
            await pushSelectedRepo();
            break;
          }

          case "pull": {
            await pullSelectedRepo();
            break;
          }

          case "diff": {
            const matrix = await isogit.statusMatrix({
              fs: expoFS,
              dir: repoDir,
            });
            const dirty = matrix.filter(
              ([fp, head2, workdir, stage]) =>
                !fp.startsWith(".git") && workdir !== stage,
            );
            if (dirty.length === 0) {
              push("(nothing to diff — working tree clean)", Colors.textMuted);
              break;
            }
            for (const [fp] of dirty.slice(0, 8)) {
              push(`--- a/${fp}`, Colors.accentDanger);
              push(`+++ b/${fp}`, Colors.accentPrimary);
              try {
                const content = (await expoFS.promises.readFile(
                  `${repoDir}/${fp}`,
                  "utf8",
                )) as string;
                const diffLines = content.split("\n").slice(0, 25);
                diffLines.forEach((l) => push(`+${l}`, Colors.accentPrimary));
                if (content.split("\n").length > 25)
                  push("... (truncated)", Colors.textMuted);
              } catch {
                /* skip */
              }
            }
            if (dirty.length > 8)
              push(
                `... and ${dirty.length - 8} more file(s)`,
                Colors.textMuted,
              );
            break;
          }

          case "remote": {
            if (gitArgs[0] === "add") {
              const [, name, url] = gitArgs;
              if (!name || !url) {
                push("Usage: git remote add <name> <url>", Colors.accentDanger);
                break;
              }
              await addRemote(selectedRepo!.id, name, url);
              push(`remote '${name}' added → ${url}`, Colors.accentPrimary);
            } else {
              const remotes = await getRemotes(selectedRepo!.id);
              if (remotes.length === 0) {
                push("(no remotes configured)", Colors.textMuted);
                break;
              }
              remotes.forEach((r) => {
                push(`${r.remote}\t${r.url} (fetch)`);
                push(`${r.remote}\t${r.url} (push)`);
              });
            }
            break;
          }

          default:
            push(
              `git: '${sub}' is not a recognised git command. See 'help'.`,
              Colors.accentDanger,
            );
        }
        return;
      }

      push(
        `${head}: command not found. Type 'help' to see available commands.`,
        Colors.accentDanger,
      );
    } catch (err: any) {
      push(`Error: ${err?.message ?? String(err)}`, Colors.accentDanger);
    }
  }, [
    cmd,
    cwd,
    repoDir,
    cwdDisplay,
    selectedRepo,
    commitChanges,
    createBranch,
    switchBranch,
    mergeInto,
    pushSelectedRepo,
    pullSelectedRepo,
    addRemote,
    getRemotes,
    push,
  ]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={styles.terminalOutput}
        contentContainerStyle={styles.terminalOutputContent}
        keyboardShouldPersistTaps="handled"
      >
        {lines.map((line, i) => (
          <Text
            key={i}
            style={[
              styles.terminalLine,
              line.color ? { color: line.color } : undefined,
            ]}
          >
            {line.text}
          </Text>
        ))}
      </ScrollView>
      <View style={styles.terminalPromptRow}>
        <Text style={styles.terminalPromptLabel} numberOfLines={1}>
          {selectedRepo?.name ?? "repo"}:{cwdDisplay} $
        </Text>
        <TextInput
          style={styles.terminalInput}
          value={cmd}
          onChangeText={(v) => {
            setCmd(v);
            setHistIdx(-1);
          }}
          onSubmitEditing={run}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder="Enter command…"
          placeholderTextColor={Colors.textMuted}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={styles.terminalHistBtn}
          onPress={historyUp}
          activeOpacity={0.7}
        >
          <Text style={styles.terminalRunText}>↑</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.terminalHistBtn}
          onPress={historyDown}
          activeOpacity={0.7}
        >
          <Text style={styles.terminalRunText}>↓</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.terminalRunBtn}
          onPress={run}
          activeOpacity={0.8}
        >
          <Text style={styles.terminalRunText}>Run</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    marginTop: 100,
  },
  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderDefault,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: Colors.textPrimary,
  },
  branchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  branchBtnText: {
    fontSize: 12,
    color: Colors.accentPrimary,
    fontWeight: "500" as const,
  },
  menuBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pushBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    height: 32,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accentPrimary,
    backgroundColor: Colors.accentPrimaryDim,
  },
  pullBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    height: 32,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accentPrimary,
    backgroundColor: Colors.accentPrimaryDim,
  },
  pushText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.accentPrimary,
  },
  dropdownLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 4,
  },
  createBranchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderMuted,
  },
  createBranchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  createBranchBtn: {
    backgroundColor: Colors.accentPrimary,
    borderRadius: Radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  createBranchBtnText: {
    color: "#fff",
    fontWeight: "600" as const,
    fontSize: 13,
  },
  branchDropdown: {
    backgroundColor: Colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderDefault,
    paddingVertical: Spacing.xs,
  },
  branchItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  branchItemActive: {
    backgroundColor: Colors.accentPrimaryDim,
  },
  branchItemText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  branchItemTextActive: {
    color: Colors.accentPrimary,
    fontWeight: "600" as const,
  },
  headLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    color: Colors.accentPrimary,
    backgroundColor: Colors.accentPrimaryDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    overflow: "hidden",
  },
  segmentWrap: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgSecondary,
  },
  tabContent: {
    flex: 1,
  },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgSecondary,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderMuted,
  },
  breadcrumbText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  breadcrumbActive: {
    color: Colors.textPrimary,
    fontWeight: "500" as const,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderMuted,
  },
  fileContent: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "500" as const,
  },
  fileMeta: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  statusIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderMuted,
  },
  changeContent: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: Colors.bgSecondary,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  countBadge: {
    backgroundColor: Colors.bgTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  countText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
  },
  commitComposer: {
    backgroundColor: Colors.bgSecondary,
    borderTopWidth: 1,
    borderTopColor: Colors.borderDefault,
    padding: Spacing.md,
  },
  commitInput: {
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.sm,
    padding: Spacing.sm + 2,
    fontSize: 14,
    color: Colors.textPrimary,
    minHeight: 60,
    maxHeight: 100,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  commitFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
  },
  charCount: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  commitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.accentPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  commitBtnDisabled: {
    backgroundColor: Colors.bgTertiary,
  },
  commitBtnText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: "#FFFFFF",
  },
  commitBtnTextDisabled: {
    color: Colors.textMuted,
  },
  commitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderMuted,
  },
  authorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  authorInitials: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
  commitContent: {
    flex: 1,
  },
  commitMessage: {
    fontSize: 14,
    fontWeight: "500" as const,
    color: Colors.textPrimary,
    marginBottom: 3,
  },
  commitMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  commitTags: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  commitBranchTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.accentPrimaryDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  commitBranchText: {
    fontSize: 10,
    fontWeight: "600" as const,
    color: Colors.accentPrimary,
  },
  shaLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: "monospace",
  },
  terminalHeader: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderDefault,
  },
  terminalTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
  },
  terminalOutput: { flex: 1, backgroundColor: Colors.codeBackground },
  terminalOutputContent: { padding: Spacing.md, gap: 4 },
  terminalLine: {
    fontFamily: "monospace",
    fontSize: 12,
    color: Colors.textPrimary,
  },
  terminalPromptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderDefault,
    backgroundColor: Colors.bgSecondary,
  },
  terminalPromptLabel: {
    fontFamily: "monospace",
    fontSize: 12,
    color: Colors.textMuted,
  },
  terminalInput: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 12,
    color: Colors.textPrimary,
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  terminalHistBtn: {
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  terminalRunBtn: {
    backgroundColor: Colors.accentPrimary,
    borderRadius: Radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  terminalRunText: { color: "#fff", fontWeight: "600" as const, fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  modalInput: {
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  modalActions: {
    flexDirection: "row" as const,
    justifyContent: "flex-end",
    gap: 8,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  modalCancelText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "500" as const,
  },
  modalSaveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: Colors.accentPrimary,
    borderRadius: Radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  modalSaveText: { fontSize: 13, color: "#fff", fontWeight: "600" as const },
  fileToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderMuted,
  },
  fileToolbarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgTertiary,
  },
  fileToolbarBtnText: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.textSecondary,
  },
  deleteConfirmText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginVertical: Spacing.sm,
  },
  deleteConfirmBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: "#EF4444",
    borderRadius: Radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  // ── Security Scan FAB ───────────────────────────────────────────────────
  securityFab: {
    position: "absolute" as const,
    bottom: 24,
    right: 20,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: "#7C3AED",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 28,
    elevation: 6,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  securityFabText: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#fff",
    letterSpacing: 0.3,
  },

  // ── Tree Sidebar ────────────────────────────────────────────────────────
  treeSidebarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  treeSidebarContainer: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: "80%" as unknown as number,
    backgroundColor: Colors.bgSecondary,
    borderRightWidth: 1,
    borderRightColor: Colors.borderDefault,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  treeSidebarHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderDefault,
    backgroundColor: Colors.bgTertiary,
  },
  treeSidebarTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
  },
  treeSidebarCloseBtn: {
    width: 36,
    height: 36,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 18,
    backgroundColor: Colors.bgElevated,
  },
  treeSidebarScroll: {
    flex: 1,
  },
  treeRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 10,
    paddingRight: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderMuted,
  },
  treeNodeText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: "400" as const,
  },
});
