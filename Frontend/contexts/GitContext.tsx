import { mockConflicts } from "@/mocks/repositories";
import { gitEngine } from "@/services/git/engine";
import { listUserRepos } from "@/services/github/api";
import { profileCache } from "@/services/storage/profileCache";
import { storage } from "@/services/storage/storage";
import { pushQueue } from "@/services/sync/pushQueue";
import { AppSettings, ConflictFile, ConflictHunk, GitCommit, GitHubRepo, MergeState } from "@/types/git";
import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TAG = "[GitContext]";

const defaultSettings: AppSettings = {
  userConfig: { name: "", email: "" },
  notifications: {
    commitSuccess: true,
    commitFailed: true,
    mergeConflicts: true,
    backgroundTasks: false,
    p2pTransfers: true,
  },
  accentColor: "green",
  codeFontSize: 13,
  p2pMethod: "wifi-direct",
  autoAcceptKnown: true,
  discoveryVisible: true,
  enableReflog: true,
  githubToken: null,
  githubClientId: null,
};

const SETTINGS_KEY = "gitlane:settings";

export const [GitProvider, useGit] = createContextHook(() => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "warning" | "info";
    message: string;
  } | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<{
    phase: string;
    loaded: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    if (!selectedRepoId) {
      setMergeState(null);
      setConflicts([]);
      return;
    }
    gitEngine.restoreMergeState(selectedRepoId)
      .then((state) => {
        if (state) {
          setMergeState(state);
          setConflicts(state.conflicts);
        } else {
          setMergeState(null);
          setConflicts([]);
        }
      })
      .catch((err) => {
        console.warn(TAG, "Failed to restore merge state", err);
      });
  }, [selectedRepoId]);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => storage.getSettings<AppSettings>(defaultSettings),
  });

  const settings = settingsQuery.data ?? defaultSettings;

  const repositoriesQuery = useQuery({
    queryKey: ["repositories"],
    queryFn: () => gitEngine.listRepositories(),
  });

  const githubReposQuery = useQuery({
    queryKey: ["githubRepos", settings.githubToken],
    queryFn: async () => {
      if (!settings.githubToken) return [] as GitHubRepo[];
      return listUserRepos(settings.githubToken);
    },
    enabled: !!settings.githubToken,
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings: AppSettings) => {
      await storage.setSettings(newSettings);
      return newSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      const updated = { ...settings, ...partial };
      saveSettingsMutation.mutate(updated);
    },
    [settings, saveSettingsMutation],
  );

  const selectedRepo = useMemo(
    () => repositoriesQuery.data?.find((r) => r.id === selectedRepoId) ?? null,
    [repositoriesQuery.data, selectedRepoId],
  );

  useEffect(() => {
    if (
      !selectedRepoId &&
      repositoriesQuery.data &&
      repositoriesQuery.data.length > 0
    ) {
      setSelectedRepoId(repositoriesQuery.data[0].id);
    }
  }, [repositoriesQuery.data, selectedRepoId]);

  const filesQuery = useQuery({
    queryKey: ["files", selectedRepoId],
    queryFn: () =>
      selectedRepoId ? gitEngine.getWorkingTree(selectedRepoId) : [],
    enabled: !!selectedRepoId,
  });

  const commitsQuery = useQuery({
    queryKey: ["commits", selectedRepoId],
    queryFn: async (): Promise<GitCommit[]> => {
      if (!selectedRepoId || !selectedRepo) return [];
      const cached = await storage.readCache<GitCommit[]>(selectedRepo.path, "commits");
      if (cached) return cached;
      const commits = await gitEngine.getCommits(selectedRepoId);
      await storage.writeCache(selectedRepo.path, "commits", commits);
      return commits;
    },
    enabled: !!selectedRepoId,
  });

  const addRepositoryMutation = useMutation({
    mutationFn: async ({
      name,
      addReadme,
    }: {
      name: string;
      addReadme?: boolean;
    }) => gitEngine.createRepository(name, addReadme ?? true),
    onSuccess: (repo) => {
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
      showToast("success", `Repository "${repo.name}" created`);
      setSelectedRepoId(repo.id);
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to create repository";
      showToast("error", message);
    },
  });

  const addRepository = useCallback(
    (input: { name: string; addReadme?: boolean }) => {
      return addRepositoryMutation.mutateAsync(input);
    },
    [addRepositoryMutation],
  );

  const deleteRepository = useCallback(
    async (id: string) => {
      try {
        await gitEngine.deleteRepository(id);
        if (selectedRepoId === id) setSelectedRepoId(null);
        await queryClient.invalidateQueries({ queryKey: ["repositories"] });
        showToast("warning", "Repository removed");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete repository";
        showToast("error", message);
      }
    },
    [selectedRepoId, queryClient],
  );

  const switchBranch = useCallback(
    async (repoId: string, branchName: string) => {
      await gitEngine.switchBranch(repoId, branchName);
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
      queryClient.invalidateQueries({ queryKey: ["files", repoId] });
      queryClient.invalidateQueries({ queryKey: ["commits", repoId] });
      showToast("success", `Switched to ${branchName}`);
    },
    [queryClient],
  );

  const createBranch = useCallback(
    async (repoId: string, name: string) => {
      await gitEngine.createBranch(repoId, name);
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
      showToast("success", `Branch "${name}" created`);
    },
    [queryClient],
  );

  const deleteBranch = useCallback(
    async (repoId: string, name: string) => {
      await gitEngine.deleteBranch(repoId, name);
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
      showToast("warning", `Branch "${name}" deleted`);
    },
    [queryClient],
  );

  const renameBranch = useCallback(
    async (repoId: string, oldName: string, newName: string) => {
      await gitEngine.renameBranch(repoId, oldName, newName);
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
      showToast("success", `Branch renamed to "${newName}"`);
    },
    [queryClient],
  );

  const stageFile = useCallback(
    async (fileId: string) => {
      if (!selectedRepoId) return;
      await gitEngine.stageFile(selectedRepoId, fileId);
      queryClient.invalidateQueries({ queryKey: ["files", selectedRepoId] });
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
    },
    [selectedRepoId, queryClient],
  );

  const unstageFile = useCallback(
    async (fileId: string) => {
      if (!selectedRepoId) return;
      await gitEngine.unstageFile(selectedRepoId, fileId);
      queryClient.invalidateQueries({ queryKey: ["files", selectedRepoId] });
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
    },
    [selectedRepoId, queryClient],
  );

  const createFile = useCallback(
    async (filepath: string, content: string = '') => {
      if (!selectedRepoId) return;
      await gitEngine.createFile(selectedRepoId, filepath, content);
      await queryClient.refetchQueries({ queryKey: ['files', selectedRepoId] });
      await queryClient.refetchQueries({ queryKey: ['repositories'] });
      showToast('success', `Created ${filepath}`);
    },
    [selectedRepoId, queryClient],
  );

  const deleteFile = useCallback(
    async (filepath: string) => {
      if (!selectedRepoId) return;
      await gitEngine.deleteFile(selectedRepoId, filepath);
      await queryClient.refetchQueries({ queryKey: ['files', selectedRepoId] });
      await queryClient.refetchQueries({ queryKey: ['repositories'] });
      showToast('warning', `Deleted ${filepath}`);
    },
    [selectedRepoId, queryClient],
  );

  const saveFile = useCallback(
    async (filepath: string, content: string) => {
      if (!selectedRepoId) return;
      await gitEngine.saveFile(selectedRepoId, filepath, content);
      await queryClient.refetchQueries({ queryKey: ['files', selectedRepoId] });
      showToast('success', `Saved ${filepath}`);
    },
    [selectedRepoId, queryClient],
  );

  const revertFile = useCallback(
    async (filepath: string) => {
      if (!selectedRepoId) return;
      await gitEngine.revertFile(selectedRepoId, filepath);
      await queryClient.refetchQueries({ queryKey: ['files', selectedRepoId] });
      await queryClient.refetchQueries({ queryKey: ['repositories'] });
      showToast('info', `Reverted ${filepath}`);
    },
    [selectedRepoId, queryClient],
  );

  const revertToCommit = useCallback(
    async (targetSha: string) => {
      if (!selectedRepoId) return;
      const author = {
        name: settings.userConfig.name,
        email: settings.userConfig.email,
      };
      try {
        await gitEngine.revertToCommit(selectedRepoId, targetSha, author);
        await queryClient.invalidateQueries({ queryKey: ['files', selectedRepoId] });
        await queryClient.invalidateQueries({ queryKey: ['commits', selectedRepoId] });
        await queryClient.invalidateQueries({ queryKey: ['repositories'] });
        showToast('success', `Reverted to commit ${targetSha.slice(0, 7)}`);
      } catch (err: any) {
        console.error(TAG, 'revertToCommit failed', err);
        showToast('error', `Revert failed: ${err?.message ?? 'Unknown error'}`);
      }
    },
    [selectedRepoId, settings, queryClient],
  );

  const getReflog = useCallback(
    async () => {
      if (!selectedRepoId) return [];
      return gitEngine.getReflog(selectedRepoId);
    },
    [selectedRepoId],
  );

  const commitChanges = useCallback(
    async (message: string) => {
      if (!selectedRepo) return;
      
      // Validate name and email are set
      if (!settings.userConfig.name || !settings.userConfig.email) {
        showToast("warning", "Please set your name and email in Settings first!");
        return;
      }
      
      const author = {
        name: settings.userConfig.name,
        email: settings.userConfig.email,
      };
      console.log(TAG, `commitChanges("${message}") in ${selectedRepo.id}`);
      await gitEngine.commit(selectedRepo.id, message, author);
      // Automatic cache invalidation
      await storage.deleteCache(selectedRepo.path);
      // Track offline commit for profile graph
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      await profileCache.addOfflineCommit({
        repoName: selectedRepo.name,
        date: dateStr,
        message,
        timestamp: Date.now(),
      });
      queryClient.invalidateQueries({ queryKey: ["repositories"] });
      queryClient.invalidateQueries({ queryKey: ["files", selectedRepo.id] });
      queryClient.invalidateQueries({ queryKey: ["commits", selectedRepo.id] });
      showToast("success", `Committed: "${message}"`);
    },
    [
      selectedRepo,
      settings.userConfig.name,
      settings.userConfig.email,
      queryClient,
    ],
  );

  const cloneRepository = useCallback(
    async (url: string, name: string) => {
      setIsCloning(true);
      setCloneProgress({ phase: "starting", loaded: 0, total: 0 });
      console.log(TAG, `cloneRepository("${url}", "${name}")`);
      try {
        const repo = await gitEngine.cloneRepo(
          url,
          name,
          (phase, loaded, total) => setCloneProgress({ phase, loaded, total }),
          settings.githubToken ?? undefined,
        );
        queryClient.invalidateQueries({ queryKey: ["repositories"] });
        showToast("success", `Cloned "${repo.name}"`);
        setIsCloning(false);
        setCloneProgress(null);
        setSelectedRepoId(repo.id);
        return repo;
      } catch (err) {
        setIsCloning(false);
        setCloneProgress(null);
        const message = err instanceof Error ? err.message : "Clone failed";
        showToast("error", message);
        throw err;
      }
    },
    [queryClient, settings.githubToken],
  );

  const cloneGitHubRepo = useCallback(
    async (gh: GitHubRepo) => {
      const name = gh.name;
      return cloneRepository(gh.clone_url, name);
    },
    [cloneRepository],
  );

  const pushSelectedRepo = useCallback(
    async (branch?: string) => {
      if (!selectedRepo) return;
      if (!settings.githubToken) {
        showToast("warning", "GitHub token not set");
        return;
      }

      const targetBranch = branch ?? selectedRepo.currentBranch ?? "main";

      // Check connectivity first
      const online = await pushQueue.isOnline();
      if (!online) {
        // Queue the push for later
        await pushQueue.enqueue(
          selectedRepo.id,
          selectedRepo.name,
          targetBranch,
        );
        return; // toast shown by queue subscriber
      }

      try {
        const author = {
          name: settings.userConfig.name,
          email: settings.userConfig.email,
        };
        const result = await gitEngine.push(
          selectedRepo.id,
          settings.githubToken,
          targetBranch,
          author,
        );

        if (!result.clean) {
          // Push triggered a pull that found merge conflicts
          setMergeState(result.mergeState);
          setConflicts(result.mergeState.conflicts);
          showToast("warning", "Remote has diverged — resolve merge conflicts before pushing");
          router.push("/merge-conflicts");
          return;
        }

        showToast("success", `Pushed to origin/${targetBranch}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Push failed";
        showToast("error", message);
      }
    },
    [selectedRepo, settings.githubToken, settings.userConfig],
  );

  const pullSelectedRepo = useCallback(
    async (branch?: string) => {
      if (!selectedRepo) return;
      if (!settings.githubToken) {
        showToast("warning", "GitHub token not set");
        return;
      }

      const targetBranch = branch ?? selectedRepo.currentBranch ?? "main";

      const online = await pushQueue.isOnline();
      if (!online) {
        showToast("warning", "Cannot pull while offline");
        return;
      }

      try {
        const author = {
          name: settings.userConfig.name,
          email: settings.userConfig.email,
        };
        const result = await gitEngine.pull(
          selectedRepo.id,
          settings.githubToken,
          targetBranch,
          author,
        );

        if (!result.clean) {
          // Pull found merge conflicts
          setMergeState(result.mergeState);
          setConflicts(result.mergeState.conflicts);
          showToast("warning", "Merge conflicts detected — resolve them to complete the pull");
          router.push("/merge-conflicts");
          return;
        }

        await storage.deleteCache(selectedRepo.path);
        queryClient.invalidateQueries({ queryKey: ["repositories"] });
        queryClient.invalidateQueries({ queryKey: ["files", selectedRepo.id] });
        queryClient.invalidateQueries({
          queryKey: ["commits", selectedRepo.id],
        });
        showToast("success", `Pulled from origin/${targetBranch}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Pull failed";
        showToast("error", message);
      }
    },
    [selectedRepo, settings.githubToken, settings.userConfig, queryClient],
  );

  const addRemote = useCallback(
    async (repoId: string, remoteName: string, url: string) => {
      await gitEngine.addRemote(repoId, remoteName, url);
      showToast("success", `Remote "${remoteName}" set to ${url}`);
    },
    [],
  );

  const getRemotes = useCallback(async (repoId: string) => {
    return gitEngine.getRemotes(repoId);
  }, []);

  const mergeInto = useCallback(
    async (repoId: string, theirBranch: string) => {
      const repo = repositoriesQuery.data?.find((r) => r.id === repoId);
      if (!repo) return;
      const author = {
        name: settings.userConfig.name,
        email: settings.userConfig.email,
      };
      console.log(TAG, `mergeInto(${repoId}, ${theirBranch})`);
      try {
        const result = await gitEngine.merge(repoId, theirBranch, author);
        if (result.clean) {
          await storage.deleteCache(repo.path);
          queryClient.invalidateQueries({ queryKey: ["repositories"] });
          queryClient.invalidateQueries({ queryKey: ["files", repoId] });
          queryClient.invalidateQueries({ queryKey: ["commits", repoId] });
          showToast("success", `Merged ${theirBranch}`);
        } else {
          // Conflicts detected — enter merge resolution mode
          setMergeState(result.mergeState);
          setConflicts(result.mergeState.conflicts);
          showToast("warning", `${result.mergeState.conflicts.length} file(s) have conflicts`);
          // Navigate to merge resolution screen
          router.push("/merge-conflicts");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Merge failed";
        showToast("error", message);
        throw err;
      }
    },
    [repositoriesQuery.data, settings.userConfig, queryClient, router],
  );

  const resolveConflictHunk = useCallback(
    (conflictId: string, hunkId: string, resolution: 'ours' | 'theirs' | 'both' | 'manual', manualContent?: string) => {
      setMergeState((prev) => {
        if (!prev) return prev;
        const updatedConflicts = prev.conflicts.map((file) => {
          if (file.id !== conflictId) return file;
          const updatedHunks = file.hunks.map((hunk) => {
            if (hunk.id !== hunkId) return hunk;
            let resultContent = '';
            switch (resolution) {
              case 'ours':
                resultContent = hunk.oursContent;
                break;
              case 'theirs':
                resultContent = hunk.theirsContent;
                break;
              case 'both':
                resultContent = hunk.oursContent + '\n' + hunk.theirsContent;
                break;
              case 'manual':
                resultContent = manualContent ?? '';
                break;
            }
            return { ...hunk, resolved: true, resolution, resultContent };
          });
          const allHunksResolved = updatedHunks.every((h) => h.resolved);
          return {
            ...file,
            hunks: updatedHunks,
            resolved: allHunksResolved,
            resultContent: allHunksResolved ? 'resolved' : '',
          };
        });
        return { ...prev, conflicts: updatedConflicts };
      });
      // Also update the flat conflicts array
      setConflicts((prev) =>
        prev.map((c) => {
          if (c.id !== conflictId) return c;
          const updatedHunks = c.hunks.map((hunk) => {
            if (hunk.id !== hunkId) return hunk;
            let resultContent = '';
            switch (resolution) {
              case 'ours': resultContent = hunk.oursContent; break;
              case 'theirs': resultContent = hunk.theirsContent; break;
              case 'both': resultContent = hunk.oursContent + '\n' + hunk.theirsContent; break;
              case 'manual': resultContent = manualContent ?? ''; break;
            }
            return { ...hunk, resolved: true, resolution, resultContent };
          });
          const allResolved = updatedHunks.every((h) => h.resolved);
          return { ...c, hunks: updatedHunks, resolved: allResolved };
        }),
      );
    },
    [],
  );

  const stageResolvedConflictFile = useCallback(
    async (conflictFile: ConflictFile) => {
      if (!mergeState) return;
      // Build resolved content from hunks
      const dir = gitEngine.resolveRepoDir(mergeState.repoId);
      // Read raw conflicted file
      const { expoFS } = await import('@/services/git/expo-fs');
      const rawContent = (await expoFS.promises.readFile(
        `${dir}/${conflictFile.path}`,
        'utf8',
      )) as string;
      const resolvedContent = gitEngine.buildResolvedContent(rawContent, conflictFile.hunks);
      await gitEngine.stageResolvedFile(mergeState.repoId, conflictFile.path, resolvedContent);
      showToast("success", `${conflictFile.name} marked as resolved`);
    },
    [mergeState],
  );

  const finalizeMerge = useCallback(
    async () => {
      if (!mergeState) return;
      const author = {
        name: settings.userConfig.name,
        email: settings.userConfig.email,
      };
      try {
        // Pass all resolved conflict files so engine can stage them
        const resolvedFiles = mergeState.conflicts
          .filter((c) => c.resolved)
          .map((c) => ({ path: c.path, hunks: c.hunks }));

        await gitEngine.finalizeMerge(
          mergeState.repoId,
          mergeState.theirsBranch,
          author,
          mergeState.txId,
          resolvedFiles,
        );
        await storage.deleteCache(gitEngine.resolveRepoDir(mergeState.repoId));
        queryClient.invalidateQueries({ queryKey: ["repositories"] });
        queryClient.invalidateQueries({ queryKey: ["files", mergeState.repoId] });
        queryClient.invalidateQueries({ queryKey: ["commits", mergeState.repoId] });

        const mergedBranch = mergeState.oursBranch;
        const mergedRepoId = mergeState.repoId;
        const mergedRepoName =
          repositoriesQuery.data?.find((r) => r.id === mergedRepoId)?.name ?? mergedRepoId;

        setMergeState(null);
        setConflicts([]);
        showToast("success", `Merge completed: ${mergeState.theirsBranch} → ${mergedBranch}`);

        // ── Auto-push after successful merge ──
        if (!settings.githubToken) {
          console.log(TAG, "No GitHub token — skipping post-merge push");
        } else {
          const online = await pushQueue.isOnline();
          if (online) {
            try {
              console.log(TAG, `Post-merge push → origin/${mergedBranch}`);
              showToast("info", `Pushing merged changes to origin/${mergedBranch}…`);
              await gitEngine.push(mergedRepoId, settings.githubToken, mergedBranch, author);
              queryClient.invalidateQueries({ queryKey: ["commits", mergedRepoId] });
              showToast("success", `Pushed merged changes to origin/${mergedBranch}`);
            } catch (pushErr) {
              const pushMsg = pushErr instanceof Error ? pushErr.message : "Push failed";
              console.warn(TAG, "Post-merge push failed:", pushMsg);
              // Push failed online — queue it so it retries later
              await pushQueue.enqueue(mergedRepoId, mergedRepoName, mergedBranch);
              showToast("warning", `Push failed — queued for retry: ${pushMsg}`);
            }
          } else {
            // Offline — enqueue push for when connectivity returns
            console.log(TAG, "Offline — queueing post-merge push");
            await pushQueue.enqueue(mergedRepoId, mergedRepoName, mergedBranch);
            showToast("info", `Offline — push queued for origin/${mergedBranch}`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Finalize merge failed";
        showToast("error", message);
      }
    },
    [mergeState, settings.userConfig, settings.githubToken, queryClient, repositoriesQuery.data],
  );

  const abortMerge = useCallback(
    async () => {
      if (!mergeState) return;
      try {
        await gitEngine.abortMerge(mergeState.repoId, mergeState.txId);
        queryClient.invalidateQueries({ queryKey: ["repositories"] });
        queryClient.invalidateQueries({ queryKey: ["files", mergeState.repoId] });
        setMergeState(null);
        setConflicts([]);
        showToast("warning", "Merge aborted");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Abort merge failed";
        showToast("error", message);
      }
    },
    [mergeState, queryClient],
  );

  const showToast = useCallback(
    (type: "success" | "error" | "warning" | "info", message: string) => {
      setToastMessage({ type, message });
      setTimeout(() => setToastMessage(null), 3000);
    },
    [],
  );

  // ── Push Queue: start monitoring + subscribe to events ─────────────
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  useEffect(() => {
    pushQueue.startMonitoring();

    const unsub = pushQueue.subscribe((event) => {
      switch (event.type) {
        case "queued":
          showToastRef.current("info", event.message);
          break;
        case "drain-start":
          showToastRef.current("info", event.message);
          break;
        case "syncing":
          showToastRef.current("info", event.message);
          break;
        case "success":
          showToastRef.current("success", event.message);
          queryClient.invalidateQueries({ queryKey: ["repositories"] });
          break;
        case "failed":
          showToastRef.current("error", event.message);
          break;
        case "drain-end":
          showToastRef.current(
            event.remaining === 0 ? "success" : "warning",
            event.message,
          );
          queryClient.invalidateQueries({ queryKey: ["repositories"] });
          break;
      }
    });

    return () => {
      unsub();
      pushQueue.stopMonitoring();
    };
  }, [queryClient]);

  return {
    repositories: repositoriesQuery.data ?? [],
    githubRepos: githubReposQuery.data ?? [],
    selectedRepo,
    selectedRepoId,
    setSelectedRepoId,
    commits: commitsQuery.data ?? [],
    files: filesQuery.data ?? [],
    conflicts,
    mergeState,
    settings,
    updateSettings,
    addRepository,
    deleteRepository,
    cloneRepository,
    cloneGitHubRepo,
    pushSelectedRepo,
    pullSelectedRepo,
    addRemote,
    getRemotes,
    mergeInto,
    switchBranch,
    createBranch,
    deleteBranch,
    renameBranch,
    stageFile,
    unstageFile,
    createFile,
    deleteFile,
    saveFile,
    revertFile,
    revertToCommit,
    getReflog,
    commitChanges,
    resolveConflictHunk,
    stageResolvedConflictFile,
    finalizeMerge,
    abortMerge,
    toastMessage,
    showToast,
    isCloning,
    cloneProgress,
    isLoading:
      settingsQuery.isLoading ||
      repositoriesQuery.isLoading ||
      filesQuery.isLoading ||
      commitsQuery.isLoading ||
      githubReposQuery.isLoading,
  };
});
