/**
 * P2P Transfer Screen  —  GitLane to GitLane
 *
 * Transfer methods (all offline unless noted):
 *
 *  1. File Share – write a .gitlanepatch to device cache, open OS share sheet
 *                  (AirDrop / Nearby Share / Bluetooth). Offline.
 *                  Receiver: document picker → import.
 *
 *  2. WebSocket Relay – WebSocket relay via PieSocket + QR session pairing.
 *                  Requires internet but works across any network.
 *
 * Both methods share the same commit-selection UI and DiffViewer.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated as RNAnimated,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Share2,
  FolderGit2,
  CheckCircle,
  Smartphone,
  Zap,
  GitCommit as GitCommitIcon,
  ChevronRight,
  XCircle,
  ArrowLeft,
  FileDown,
  Check,
  Wifi,
  ScanLine,
  Radio,
  Copy,
  Info,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import Colors from '@/constants/colors';
import { Spacing, Radius } from '@/constants/theme';
import { useGit } from '@/contexts/GitContext';
import SegmentedControl from '@/components/SegmentedControl';
import GlowButton from '@/components/GlowButton';
import DiffViewer from '@/components/DiffViewer';
import { gitEngine } from '@/services/git/engine';
import {
  sharePatch,
  importPatch,
  deletePatchFile,
  startSenderSession,
  joinReceiverSession,
  extractToken,
  applyPatch,
} from '@/services/p2p/p2pService';
import type {
  PatchPayload,
  SenderSession,
  ReceiverSession,
  LiveStatus,
  LiveProgress,
} from '@/services/p2p/p2pService';
import type { GitCommit } from '@/types/git';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const QR_SIZE = Math.min(SCREEN_W - 64, 280);

// ─── Types ────────────────────────────────────────────────────────────────────

type TransferMethod = 'file' | 'relay';
type SendStep =
  | 'select-repo'
  | 'select-commits'
  | 'building'
  | 'qr-display'
  | 'file-complete';
type ReceiveStep =
  | 'idle'
  | 'scanning'
  | 'importing'
  | 'relay-receiving'
  | 'review-diff'
  | 'accepted';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haptic(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) {
  if (Platform.OS !== 'web') Haptics.impactAsync(style);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MethodChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.methodChipBtn, active && styles.methodChipBtnActive]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {icon}
      <Text style={[styles.methodChipLabel, active && styles.methodChipLabelActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function CommitRow({
  commit,
  selected,
  onPress,
}: {
  commit: GitCommit;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.commitRow, selected && styles.commitRowSelected]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <GitCommitIcon size={15} color={selected ? Colors.accentPrimary : Colors.textMuted} />
      <View style={styles.commitInfo}>
        <Text style={styles.commitMsg} numberOfLines={1}>{commit.message}</Text>
        <Text style={styles.commitMeta}>
          {commit.shortSha} · {commit.author} · {commit.date}
        </Text>
        {(commit.filesChanged > 0 || commit.additions > 0 || commit.deletions > 0) && (
          <View style={styles.commitStats}>
            {commit.filesChanged > 0 && (
              <Text style={styles.statFiles}>{commit.filesChanged} files</Text>
            )}
            {commit.additions > 0 && (
              <Text style={styles.statAdd}>+{commit.additions}</Text>
            )}
            {commit.deletions > 0 && (
              <Text style={styles.statDel}>-{commit.deletions}</Text>
            )}
          </View>
        )}
      </View>
      {selected ? (
        <CheckCircle size={17} color={Colors.accentPrimary} />
      ) : (
        <View style={styles.unselCircle} />
      )}
    </TouchableOpacity>
  );
}

function DoneCard({
  title,
  subtitle,
  meta,
  onDone,
}: {
  title: string;
  subtitle: string;
  meta?: Array<{ label: string; value: string }>;
  onDone: () => void;
}) {
  const scale = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 70,
      friction: 8,
    }).start();
    haptic(Haptics.ImpactFeedbackStyle.Light);
  }, []);
  return (
    <View style={styles.doneCard}>
      <RNAnimated.View style={{ transform: [{ scale }], marginBottom: Spacing.lg }}>
        <CheckCircle size={68} color={Colors.accentPrimary} strokeWidth={1.5} />
      </RNAnimated.View>
      <Text style={styles.doneTitle}>{title}</Text>
      <Text style={styles.doneSub}>{subtitle}</Text>
      {meta && meta.length > 0 && (
        <View style={styles.doneMeta}>
          {meta.map((row) => (
            <View key={row.label} style={styles.doneMetaRow}>
              <Text style={styles.doneMetaLabel}>{row.label}</Text>
              <Text style={styles.doneMetaValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ marginTop: Spacing.xl, width: '100%' }}>
        <GlowButton title="Done" onPress={onDone} fullWidth icon={<Check size={18} color="#fff" />} />
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function TransferScreen() {
  const insets = useSafeAreaInsets();
  const { repositories, settings } = useGit();

  const [mode, setMode] = useState(0);
  const [method, setMethod] = useState<TransferMethod>('file');

  // ── Send shared state ──
  const [sendStep, setSendStep] = useState<SendStep>('select-repo');
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());
  const [repoCommits, setRepoCommits] = useState<GitCommit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);

  // ── File Send ──
  const [isSharing, setIsSharing] = useState(false);
  const [sharedPayload, setSharedPayload] = useState<PatchPayload | null>(null);
  const [patchFileUri, setPatchFileUri] = useState('');

  // ── Relay Send ──
  const senderSessionRef = useRef<SenderSession | null>(null);
  const [liveToken, setLiveToken] = useState('');
  const [liveQRData, setLiveQRData] = useState('');
  const [liveSendStatus, setLiveSendStatus] = useState<LiveStatus>('connecting');
  const [liveSendProgress, setLiveSendProgress] = useState<LiveProgress>({ sent: 0, total: 0 });

  // ── Receive shared ──
  const [receiveStep, setReceiveStep] = useState<ReceiveStep>('idle');
  const [importedPayload, setImportedPayload] = useState<PatchPayload | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  // ── Relay Receive ──
  const receiverSessionRef = useRef<ReceiverSession | null>(null);
  const [liveRecvStatus, setLiveRecvStatus] = useState<LiveStatus>('connecting');
  const [liveRecvProgress, setLiveRecvProgress] = useState<LiveProgress>({ sent: 0, total: 0 });
  const [tokenInput, setTokenInput] = useState('');

  // ─── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedRepoId) { setRepoCommits([]); return; }
    setIsLoadingCommits(true);
    gitEngine.getCommits(selectedRepoId)
      .then(setRepoCommits)
      .catch(() => setRepoCommits([]))
      .finally(() => setIsLoadingCommits(false));
  }, [selectedRepoId]);

  useEffect(() => () => {
    if (patchFileUri) deletePatchFile(patchFileUri);
    senderSessionRef.current?.cancel();
    receiverSessionRef.current?.cancel();
  }, []);

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const selectedRepo = repositories.find((r) => r.id === selectedRepoId);
  const commitShas = useMemo(
    () =>
      selectedCommits.size > 0
        ? Array.from(selectedCommits)
        : repoCommits.slice(0, 20).map((c) => c.sha),
    [selectedCommits, repoCommits],
  );

  const toggleCommit = (sha: string) => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCommits((prev) => {
      const next = new Set(prev);
      next.has(sha) ? next.delete(sha) : next.add(sha);
      return next;
    });
  };

  // ─── Reset helpers ────────────────────────────────────────────────────────────

  const resetSend = useCallback(() => {
    setSendStep('select-repo');
    setSelectedRepoId(null);
    setSelectedCommits(new Set());
    setSharedPayload(null);
    senderSessionRef.current?.cancel();
    senderSessionRef.current = null;
    setLiveToken('');
    setLiveQRData('');
  }, []);

  const resetReceive = useCallback(() => {
    setReceiveStep('idle');
    setImportedPayload(null);
    scannedRef.current = false;
    receiverSessionRef.current?.cancel();
    receiverSessionRef.current = null;
  }, []);

  const handleModeChange = (idx: number) => {
    setMode(idx);
    if (idx === 0) resetSend(); else resetReceive();
  };

  // ─── File Send ────────────────────────────────────────────────────────────────

  const handleFileShare = async () => {
    if (!selectedRepo) return;
    setIsSharing(true);
    haptic();
    try {
      const { payload, fileUri } = await sharePatch(
        selectedRepo.id,
        selectedRepo.name,
        settings.userConfig.name,
        commitShas,
      );
      setPatchFileUri(fileUri);
      setSharedPayload(payload);
      setSendStep('file-complete');
    } catch (e: any) {
      if (!String(e?.message ?? '').toLowerCase().includes('cancel')) {
        Alert.alert('Error', `Could not prepare patch: ${e?.message ?? e}`);
      }
    } finally {
      setIsSharing(false);
    }
  };

  // ─── Relay Send ───────────────────────────────────────────────────────────────

  const handleStartRelaySend = async () => {
    if (!selectedRepo) return;
    haptic();
    setSendStep('building');
    try {
      const session = await startSenderSession(
        selectedRepo.id,
        selectedRepo.name,
        settings.userConfig.name,
        commitShas,
        {
          onStatus: setLiveSendStatus,
          onProgress: setLiveSendProgress,
          onError: (msg) => Alert.alert('Relay Error', msg),
        },
      );
      senderSessionRef.current = session;
      setLiveToken(session.token);
      setLiveQRData(session.qrData);
      setSendStep('qr-display');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? String(e));
      setSendStep('select-commits');
    }
  };

  // ─── QR Receive ───────────────────────────────────────────────────────────────

  const handleOpenQRScan = async () => {
    // Deprecated: Direct QR removed. Kept as no-op placeholder.
  };

  // ─── File Receive ─────────────────────────────────────────────────────────────

  const handleImportFile = async () => {
    setIsImporting(true);
    haptic();
    try {
      const payload = await importPatch();
      if (!payload) { setIsImporting(false); return; }
      setImportedPayload(payload);
      setReceiveStep('review-diff');
    } catch (e: any) {
      Alert.alert('Import Failed', `Could not read patch file: ${e?.message ?? e}`);
    } finally {
      setIsImporting(false);
    }
  };

  // ─── Relay Receive ────────────────────────────────────────────────────────────

  const handleJoinRelay = (token: string) => {
    const clean = extractToken(token.trim());
    if (!clean) {
      Alert.alert('Invalid Token', "Enter the 8-character code shown on the sender's screen.");
      return;
    }
    haptic();
    setLiveRecvStatus('connecting');
    setLiveRecvProgress({ sent: 0, total: 0 });
    setReceiveStep('relay-receiving');
    const session = joinReceiverSession(clean, {
      onStatus: setLiveRecvStatus,
      onProgress: setLiveRecvProgress,
      onPayload: (payload) => {
        receiverSessionRef.current?.cancel();
        receiverSessionRef.current = null;
        setImportedPayload(payload);
        setReceiveStep('review-diff');
      },
      onError: (msg) => {
        Alert.alert('Relay Error', msg);
        setReceiveStep('idle');
      },
    });
    receiverSessionRef.current = session;
  };

  // ─── Accept / Reject ─────────────────────────────────────────────────────────

  const handleAccept = async () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    if (!importedPayload) return;

    try {
      // Apply patch to a new repo
      await applyPatch(importedPayload);
      setReceiveStep('accepted');
    } catch (err: any) {
      Alert.alert('Failed to Apply Patch', err?.message ?? 'Could not import changes');
    }
  };

  const handleReject = () => {
    haptic();
    Alert.alert('Reject Changes', 'Discard these incoming changes?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive',
        onPress: () => { setReceiveStep('idle'); setImportedPayload(null); },
      },
    ]);
  };

  // ─── Render: Repo selection ───────────────────────────────────────────────────

  function renderSelectRepo() {
    return (
      <>
        <Text style={styles.sectionLabel}>SELECT REPOSITORY</Text>
        {repositories.length === 0 ? (
          <View style={styles.emptyState}>
            <FolderGit2 size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No repositories found</Text>
            <Text style={styles.emptySub}>Clone or create a repo first.</Text>
          </View>
        ) : (
          repositories.map((repo) => (
            <TouchableOpacity
              key={repo.id}
              style={[styles.repoRow, selectedRepoId === repo.id && styles.repoRowActive]}
              onPress={() => { haptic(Haptics.ImpactFeedbackStyle.Light); setSelectedRepoId(repo.id); }}
              activeOpacity={0.75}
            >
              <FolderGit2 size={22} color={selectedRepoId === repo.id ? Colors.accentPrimary : Colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.repoName}>{repo.name}</Text>
                <Text style={styles.repoMeta}>{repo.currentBranch} · {repo.commitCount} commits · {repo.size}</Text>
              </View>
              {selectedRepoId === repo.id
                ? <CheckCircle size={18} color={Colors.accentPrimary} />
                : <ChevronRight size={16} color={Colors.textMuted} />}
            </TouchableOpacity>
          ))
        )}
        {selectedRepoId && (
          <View style={{ marginTop: Spacing.lg }}>
            <GlowButton
              title="Choose Commits →"
              onPress={() => setSendStep('select-commits')}
              fullWidth
              icon={<GitCommitIcon size={18} color="#fff" />}
            />
          </View>
        )}
      </>
    );
  }

  // ─── Render: Commit selection ─────────────────────────────────────────────────

  function renderSelectCommits() {
    const labelMap: Record<TransferMethod, string> = {
      file: 'Share Patch File',
      relay: 'Start Live Transfer',
    };
    const iconMap: Record<TransferMethod, React.ReactNode> = {
      file: <Share2 size={18} color="#fff" />,
      relay: <Radio size={18} color="#fff" />,
    };
    const onGoMap: Record<TransferMethod, () => void> = {
      file: handleFileShare,
      relay: handleStartRelaySend,
    };
    return (
      <>
        <TouchableOpacity style={styles.backRow} onPress={() => setSendStep('select-repo')}>
          <ArrowLeft size={16} color={Colors.textSecondary} />
          <Text style={styles.backText}>{selectedRepo?.name ?? 'Back'}</Text>
        </TouchableOpacity>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>SELECT COMMITS</Text>
          <Text style={styles.sectionCount}>
            {selectedCommits.size > 0 ? `${selectedCommits.size} selected` : 'all recent'}
          </Text>
        </View>
        {isLoadingCommits ? (
          <View style={styles.centerPad}>
            <ActivityIndicator color={Colors.accentPrimary} />
            <Text style={styles.dimText}>Loading commits…</Text>
          </View>
        ) : repoCommits.length === 0 ? (
          <View style={styles.centerPad}>
            <Text style={styles.dimText}>No commits found.</Text>
          </View>
        ) : repoCommits.map((c, i) => (
          <CommitRow
            key={`${c.sha}-${i}`}
            commit={c}
            selected={selectedCommits.has(c.sha) || selectedCommits.has(c.shortSha)}
            onPress={() => toggleCommit(c.sha)}
          />
        ))}
        <View style={styles.goSection}>
          <View style={styles.infoBanner}>
            <Info size={13} color={Colors.accentPrimary} />
            <Text style={styles.infoBannerText}>Only diffs are transferred — not the full repository</Text>
          </View>
          <GlowButton
            title={selectedCommits.size > 0
              ? `${labelMap[method]} — ${selectedCommits.size} commit${selectedCommits.size !== 1 ? 's' : ''}`
              : labelMap[method]}
            onPress={onGoMap[method]}
            fullWidth
            loading={method === 'file' && isSharing}
            icon={iconMap[method]}
          />
        </View>
      </>
    );
  }

  // ─── Render: Building ─────────────────────────────────────────────────────────

  function renderBuilding() {
    return (
      <View style={styles.centerFull}>
        <ActivityIndicator size="large" color={Colors.accentPrimary} />
        <Text style={styles.buildingTitle}>
          {method === 'relay' ? 'Connecting…' : 'Computing Diffs…'}
        </Text>
        <Text style={styles.buildingMeta}>
          {method === 'relay'
            ? 'Connecting to relay and building patch'
            : 'Reading git objects from local repository'}
        </Text>
      </View>
    );
  }

  // ─── Render: QR / Relay display ───────────────────────────────────────────────

  function renderQRDisplay() {
    const statusMap: Record<LiveStatus, string> = {
      connecting: 'Connecting to relay…',
      'waiting-peer': 'Waiting for receiver to scan…',
      building: 'Computing diffs — receiver can join now…',
      transferring: `Sending… ${liveSendProgress.sent}/${liveSendProgress.total} chunks`,
      complete: 'Transfer complete!',
      error: 'Connection error',
    };
    const isDone = liveSendStatus === 'complete';
    return (
      <View style={styles.qrPanel}>
        <View style={styles.qrCard}>
          {liveQRData ? (
            <QRCode value={liveQRData} size={QR_SIZE} color={Colors.textPrimary} backgroundColor={Colors.bgSecondary} />
          ) : (
            <View style={[{ width: QR_SIZE, height: QR_SIZE }, styles.qrPlaceholder]}>
              <ActivityIndicator color={Colors.accentPrimary} />
            </View>
          )}
        </View>
        {liveToken ? (
          <TouchableOpacity
            style={styles.tokenBox}
            onPress={async () => { await Clipboard.setStringAsync(liveToken); haptic(Haptics.ImpactFeedbackStyle.Light); }}
            activeOpacity={0.75}
          >
            <Text style={styles.tokenText}>{liveToken}</Text>
            <Copy size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.qrHint}>
          Open GitLane on receiver → Receive → WebSocket Relay, then scan this QR or type the code
        </Text>
        <View style={styles.liveStatusRow}>
          {!isDone
            ? <ActivityIndicator size="small" color={Colors.accentPrimary} />
            : <CheckCircle size={15} color={Colors.accentPrimary} />}
          <Text style={[styles.liveStatusText, isDone && { color: Colors.accentPrimary }]}>
            {statusMap[liveSendStatus]}
          </Text>
        </View>
        {liveSendStatus === 'transferring' && liveSendProgress.total > 0 && (
          <View style={[styles.progressTrack, { width: '85%' }]}>
            <View style={[styles.progressFill, { width: `${Math.round((liveSendProgress.sent / liveSendProgress.total) * 100)}%` }]} />
          </View>
        )}
        <View style={{ width: '100%', marginTop: Spacing.xl, gap: Spacing.sm }}>
          {isDone ? (
            <GlowButton title="Done" onPress={resetSend} fullWidth />
          ) : (
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { senderSessionRef.current?.cancel(); senderSessionRef.current = null; setSendStep('select-commits'); }}>
              <XCircle size={16} color={Colors.accentDanger} />
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ─── Render: Send ─────────────────────────────────────────────────────────────

  function renderSend() {
    if (sendStep === 'select-repo') return renderSelectRepo();
    if (sendStep === 'select-commits') return renderSelectCommits();
    if (sendStep === 'building') return renderBuilding();
    if (sendStep === 'qr-display') return renderQRDisplay();
    if (sendStep === 'file-complete' && sharedPayload) {
      return (
        <DoneCard
          title="Patch Shared!"
          subtitle={`${sharedPayload.diffFiles.length} file${sharedPayload.diffFiles.length !== 1 ? 's' : ''} in patch`}
          meta={[
            { label: 'Repository', value: sharedPayload.repoName },
            { label: 'Session', value: sharedPayload.sessionToken },
            { label: 'Commits', value: String(sharedPayload.commits.length) },
          ]}
          onDone={resetSend}
        />
      );
    }
    return null;
  }

  // ─── Render: Receive idle ─────────────────────────────────────────────────────

  function renderReceiveIdle() {
    if (method === 'file') {
      return (
        <View style={styles.receivePanel}>
          <View style={styles.receiveIllo}>
            <FileDown size={52} color={Colors.accentPrimary} strokeWidth={1.2} />
          </View>
          <Text style={styles.receiveTitle}>Import Patch File</Text>
          <Text style={styles.receiveSub}>
            Ask the sender to share their .gitlanepatch file via AirDrop, Nearby Share,
            Bluetooth, email, or USB. Then tap Import.
          </Text>
          <View style={styles.methodsRow}>
            <View style={styles.methodPill}><Wifi size={12} color={Colors.accentPrimary} /><Text style={styles.methodPillText}>WiFi Direct</Text></View>
            <View style={styles.methodPill}><Zap size={12} color={Colors.accentPrimary} /><Text style={styles.methodPillText}>AirDrop</Text></View>
            <View style={styles.methodPill}><Smartphone size={12} color={Colors.accentPrimary} /><Text style={styles.methodPillText}>Bluetooth</Text></View>
          </View>
          <View style={{ width: '100%', marginTop: Spacing.lg }}>
            <GlowButton title="Import Patch File" onPress={handleImportFile} fullWidth loading={isImporting} icon={<FileDown size={18} color="#fff" />} />
          </View>
        </View>
      );
    }

    // WebSocket Relay
    return (
      <View style={styles.receivePanel}>
        <View style={styles.receiveIllo}>
          <Radio size={52} color={Colors.accentPrimary} strokeWidth={1.2} />
        </View>
        <Text style={styles.receiveTitle}>WebSocket Relay Receive</Text>
        <Text style={styles.receiveSub}>
          Scan the QR on the sender's screen or enter their 8-character session token.
          Both devices need internet.
        </Text>
        <View style={styles.relayInputGroup}>
          <Text style={styles.relayInputLabel}>Session Token</Text>
          <View style={styles.relayInputRow}>
            <TextInput
              style={styles.relayInput}
              placeholder="ABCD1234"
              placeholderTextColor={Colors.textMuted}
              value={tokenInput}
              onChangeText={(t) => setTokenInput(t.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.joinBtn, tokenInput.length !== 8 && styles.joinBtnOff]}
              onPress={() => handleJoinRelay(tokenInput)}
              disabled={tokenInput.length !== 8}
            >
              <Text style={styles.joinBtnText}>Join</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.orRow}>
          <View style={styles.orLine} /><Text style={styles.orText}>or scan QR</Text><View style={styles.orLine} />
        </View>
        <GlowButton
          title="Scan Relay QR"
          onPress={async () => {
            if (!cameraPermission?.granted) {
              const { granted } = await requestCameraPermission();
              if (!granted) { Alert.alert('Camera Required', 'Allow camera to scan the relay QR.'); return; }
            }
            scannedRef.current = false;
            setReceiveStep('scanning');
          }}
          fullWidth
          icon={<ScanLine size={18} color="#fff" />}
        />
      </View>
    );
  }

  // ─── Render: Receive ──────────────────────────────────────────────────────────

  function renderReceive() {
    if (receiveStep === 'idle') return renderReceiveIdle();

    if (receiveStep === 'scanning') {
      return (
        <View style={styles.scannerWrapper}>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            onBarcodeScanned={({ data }) => {
              if (scannedRef.current) return;
              const token = extractToken(data);
              if (token) { scannedRef.current = true; setReceiveStep('idle'); handleJoinRelay(token); }
            }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
          <View style={styles.scanOverlayBorder} pointerEvents="none" />
          <View style={styles.scanTopBar}>
            <TouchableOpacity style={styles.scanCloseBtn} onPress={() => setReceiveStep('idle')}>
              <XCircle size={26} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.scanTopTitle}>Scan Relay QR</Text>
              <Text style={styles.scanTopSub}>Align the relay QR inside the frame</Text>
            </View>
            <View style={{ width: 32 }} />
          </View>
        </View>
      );
    }

    if (receiveStep === 'importing' || receiveStep === 'relay-receiving') {
      const statusMap: Record<LiveStatus, string> = {
        connecting: 'Connecting to relay…',
        'waiting-peer': 'Waiting for sender…',
        building: 'Sender is computing diffs…',
        transferring: 'Receiving data…',
        complete: 'Transfer complete!',
        error: 'Failed',
      };
      return (
        <View style={styles.centerFull}>
          <ActivityIndicator size="large" color={Colors.accentPrimary} />
          <Text style={styles.buildingTitle}>
            {receiveStep === 'relay-receiving' ? statusMap[liveRecvStatus] : 'Reading Patch…'}
          </Text>
          {receiveStep === 'relay-receiving' && liveRecvProgress.total > 0 && (
            <>
              <View style={[styles.progressTrack, { width: '75%', marginTop: Spacing.md }]}>
                <View style={[styles.progressFill, { width: `${Math.round((liveRecvProgress.sent / liveRecvProgress.total) * 100)}%` }]} />
              </View>
              <Text style={styles.buildingMeta}>{liveRecvProgress.sent} / {liveRecvProgress.total} chunks</Text>
            </>
          )}
          <TouchableOpacity
            style={[styles.cancelBtn, { marginTop: Spacing.xl }]}
            onPress={() => { receiverSessionRef.current?.cancel(); receiverSessionRef.current = null; setReceiveStep('idle'); }}
          >
            <XCircle size={15} color={Colors.accentDanger} />
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (receiveStep === 'review-diff' && importedPayload) {
      return (
        <View style={styles.reviewWrapper}>
          <View style={styles.incomingBar}>
            <Smartphone size={15} color={Colors.accentPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.incomingTitle}>{importedPayload.senderName} wants to share</Text>
              <Text style={styles.incomingMeta}>
                {importedPayload.repoName} · {importedPayload.commits.length} commit{importedPayload.commits.length !== 1 ? 's' : ''} · {importedPayload.diffFiles.length} files
              </Text>
            </View>
            <View style={styles.receivedPill}>
              <View style={styles.receivedDot} />
              <Text style={styles.receivedPillText}>
                {method === 'file' ? 'Imported' : 'Relay'}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <DiffViewer files={importedPayload.diffFiles} repoName={importedPayload.repoName} commitCount={importedPayload.commits.length} />
          </View>
          <View style={styles.reviewActions}>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleReject}>
              <XCircle size={17} color={Colors.accentDanger} />
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept}>
              <Check size={17} color="#fff" />
              <Text style={styles.acceptText}>Accept Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (receiveStep === 'accepted' && importedPayload) {
      return (
        <DoneCard
          title="Changes Accepted"
          subtitle={`${importedPayload.diffFiles.length} file${importedPayload.diffFiles.length !== 1 ? 's' : ''} from ${importedPayload.repoName}`}
          meta={[
            { label: 'Sender', value: importedPayload.senderName },
            { label: 'Commits', value: String(importedPayload.commits.length) },
            { label: 'Method', value: method === 'file' ? 'File Share' : 'WebSocket Relay' },
          ]}
          onDone={resetReceive}
        />
      );
    }

    return null;
  }

  // ─── Root render ──────────────────────────────────────────────────────────────

  const isFullscreen = receiveStep === 'scanning' || receiveStep === 'review-diff';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>P2P Transfer</Text>
          <Text style={styles.headerSub}>GitLane · App to App</Text>
        </View>
        <View style={styles.headerBadge}>
          <Zap size={12} color={Colors.accentPrimary} />
          <Text style={styles.headerBadgeText}>Offline Capable</Text>
        </View>
      </View>

      <View style={styles.modeBar}>
        <SegmentedControl segments={['Send', 'Receive']} selectedIndex={mode} onChange={handleModeChange} />
      </View>

      {!isFullscreen &&
        sendStep !== 'qr-display' &&
        sendStep !== 'building' &&
        sendStep !== 'file-complete' &&
        receiveStep === 'idle' && (
          <View style={styles.methodBar}>
            <MethodChip label="File Share" icon={<FileDown size={14} color={method === 'file' ? Colors.accentPrimary : Colors.textMuted} />} active={method === 'file'} onPress={() => { haptic(Haptics.ImpactFeedbackStyle.Light); setMethod('file'); }} />
            <MethodChip label="WebSocket Relay" icon={<Radio size={14} color={method === 'relay' ? Colors.accentPrimary : Colors.textMuted} />} active={method === 'relay'} onPress={() => { haptic(Haptics.ImpactFeedbackStyle.Light); setMethod('relay'); }} />
          </View>
        )}

      {isFullscreen ? (
        <View style={{ flex: 1 }}>{mode === 1 ? renderReceive() : null}</View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {mode === 0 ? renderSend() : renderReceive()}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgPrimary },
  header: {
    height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, backgroundColor: Colors.bgSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderDefault,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.accentPrimaryDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full,
  },
  headerBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.accentPrimary },
  modeBar: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderDefault,
  },
  methodBar: {
    flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderDefault,
  },
  methodChipBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 7, borderRadius: Radius.md, backgroundColor: Colors.bgTertiary,
    borderWidth: 1, borderColor: Colors.borderDefault,
  },
  methodChipBtnActive: { borderColor: Colors.accentPrimary, backgroundColor: Colors.accentPrimaryDim },
  methodChipLabel: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
  methodChipLabelActive: { color: Colors.accentPrimary },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.md },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase',
    color: Colors.textMuted, marginBottom: Spacing.sm, marginTop: Spacing.md,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionCount: { fontSize: 12, color: Colors.accentPrimary, marginBottom: Spacing.sm, marginTop: Spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.xs, marginBottom: Spacing.sm },
  backText: { fontSize: 14, color: Colors.textSecondary },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '500', color: Colors.textSecondary },
  emptySub: { fontSize: 13, color: Colors.textMuted },
  repoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.bgSecondary, borderRadius: Radius.md, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderDefault,
  },
  repoRowActive: { borderColor: Colors.accentPrimary, backgroundColor: Colors.accentPrimaryDim },
  repoName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  repoMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  commitRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.bgSecondary, borderRadius: Radius.md, padding: Spacing.md,
    marginBottom: Spacing.xs, borderWidth: 1, borderColor: Colors.borderDefault,
  },
  commitRowSelected: { borderColor: Colors.accentPrimary, backgroundColor: Colors.accentPrimaryDim },
  commitInfo: { flex: 1 },
  commitMsg: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  commitMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  commitStats: { flexDirection: 'row', gap: 8, marginTop: 4 },
  statFiles: { fontSize: 11, color: Colors.textMuted },
  statAdd: { fontSize: 11, color: Colors.accentPrimary, fontWeight: '600' },
  statDel: { fontSize: 11, color: Colors.accentDanger, fontWeight: '600' },
  unselCircle: { width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: Colors.borderDefault },
  goSection: { marginTop: Spacing.lg, gap: Spacing.sm },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.accentPrimaryDim, borderRadius: Radius.sm, padding: Spacing.sm },
  infoBannerText: { fontSize: 12, color: Colors.accentPrimary, flex: 1 },
  centerFull: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  centerPad: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  buildingTitle: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center' },
  buildingMeta: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  dimText: { fontSize: 13, color: Colors.textMuted },
  qrPanel: { alignItems: 'center', paddingTop: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.md },
  qrMethodBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accentPrimaryDim, paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full },
  qrMethodBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.accentPrimary },
  qrCard: { padding: Spacing.md, backgroundColor: Colors.bgSecondary, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderDefault },
  qrPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgSecondary, borderRadius: Radius.md },
  frameCounterRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  frameCounterText: { fontSize: 13, color: Colors.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  pauseBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.accentPrimaryDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  pauseBtnText: { fontSize: 12, fontWeight: '600', color: Colors.accentPrimary },
  progressTrack: { height: 5, width: '85%', backgroundColor: Colors.borderDefault, borderRadius: Radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.accentPrimary, borderRadius: Radius.full },
  qrHint: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 18 },
  qrMeta: { backgroundColor: Colors.bgSecondary, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderDefault, width: '100%', gap: 4 },
  qrMetaItem: { fontSize: 13, color: Colors.textSecondary },
  tokenBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgSecondary, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.accentPrimary },
  tokenText: { fontSize: 24, fontWeight: '700', letterSpacing: 5, color: Colors.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  liveStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveStatusText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.accentDanger },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: Colors.accentDanger },
  doneCard: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, paddingTop: Spacing.xxl },
  doneTitle: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.sm },
  doneSub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl },
  doneMeta: { width: '100%', backgroundColor: Colors.bgSecondary, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderDefault, gap: Spacing.sm },
  doneMetaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  doneMetaLabel: { fontSize: 13, color: Colors.textMuted },
  doneMetaValue: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  receivePanel: { alignItems: 'center', paddingTop: Spacing.xl, paddingHorizontal: Spacing.sm, gap: Spacing.md },
  receiveIllo: { width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.accentPrimaryDim, alignItems: 'center', justifyContent: 'center' },
  receiveTitle: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  receiveSub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  offlineBadgeRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap', justifyContent: 'center' },
  offlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.accentPrimaryDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  offlineBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.accentPrimary },
  methodsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  methodPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.accentPrimaryDim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  methodPillText: { fontSize: 11, fontWeight: '600', color: Colors.accentPrimary },
  relayInputGroup: { width: '100%', gap: Spacing.xs },
  relayInputLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  relayInputRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  relayInput: { flex: 1, height: 52, backgroundColor: Colors.bgSecondary, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderDefault, paddingHorizontal: Spacing.md, fontSize: 22, fontWeight: '700', letterSpacing: 4, color: Colors.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', textAlign: 'center' },
  joinBtn: { height: 52, paddingHorizontal: Spacing.lg, backgroundColor: Colors.accentPrimary, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  joinBtnOff: { opacity: 0.35 },
  joinBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, width: '100%' },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.borderDefault },
  orText: { fontSize: 12, color: Colors.textMuted },
  scannerWrapper: { flex: 1, backgroundColor: '#000' },
  scannerCamera: { flex: 1 },
  scanOverlayBorder: { position: 'absolute', top: '20%', left: '10%', right: '10%', bottom: '30%', borderWidth: 2, borderColor: Colors.accentPrimary, borderRadius: Radius.lg },
  scanTopBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: Spacing.md, paddingTop: Spacing.lg, backgroundColor: 'rgba(0,0,0,0.55)' },
  scanCloseBtn: { width: 32 },
  scanTopTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  scanTopSub: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2, textAlign: 'center' },
  scanBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.md, paddingBottom: Spacing.xl, backgroundColor: 'rgba(0,0,0,0.7)', gap: 8 },
  scanProgressText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  scanMissingText: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  frameDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  frameDot: { width: 10, height: 10, borderRadius: 5 },
  frameDotDone: { backgroundColor: Colors.accentPrimary },
  frameDotPending: { backgroundColor: 'rgba(255,255,255,0.25)' },
  frameDotsMore: { fontSize: 11, color: 'rgba(255,255,255,0.5)', alignSelf: 'center' },
  reviewWrapper: { flex: 1 },
  incomingBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.md, backgroundColor: Colors.bgSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderDefault },
  incomingTitle: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  incomingMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  receivedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.accentPrimaryDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  receivedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accentPrimary },
  receivedPillText: { fontSize: 11, color: Colors.accentPrimary, fontWeight: '600' },
  reviewActions: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.bgSecondary, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.borderDefault },
  rejectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.accentDanger },
  rejectText: { fontSize: 14, fontWeight: '600', color: Colors.accentDanger },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 2, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.accentPrimary },
  acceptText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
