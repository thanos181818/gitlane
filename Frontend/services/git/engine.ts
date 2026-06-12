import type {
    ChangeType,
    ConflictFile,
    ConflictHunk,
    FileStatus,
    GitBranch,
    GitCommit,
    GitFile,
    MergeState,
    Repository,
} from "@/types/git";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { expoFS } from "./expo-fs";

// ─── P2P diff types ──────────────────────────────────────────────────────────

export interface CommitDiffFile {
  filepath: string;
  oldContent: string;
  newContent: string;
  changeType: "M" | "A" | "D";
}

// Minimal interface matching what isomorphic-git passes into git.walk map()
interface WalkerEntry {
  oid(): Promise<string>;
  type(): Promise<"blob" | "tree" | "commit" | "tag">;
  mode(): Promise<number>;
  content(): Promise<Uint8Array | void>;
}

// ---------------------------------------------------------------------------
// File-system & constants
// ---------------------------------------------------------------------------

// `fs` is our custom Expo-native adapter – NO IndexedDB, NO LightningFS
const fs = expoFS;

// All git paths are POSIX under /repos/*  (mapped to Expo documentDirectory)
const BASE_DIR = "/repos";
// Demo repo removed

const TAG = "[GitEngine]";

// ---------------------------------------------------------------------------
// Transaction helpers  (written into .git via ExpoFS)
// ---------------------------------------------------------------------------

export interface TransactionEntry {
  id: string;
  type: "commit" | "merge" | "branch" | "clone" | "pull" | "push";
  status: "PENDING" | "COMPLETED" | "FAILED";
  message?: string;
  startedAt: number;
  completedAt?: number;
}

function txFilePath(dir: string) {
  return joinPath(dir, ".git", "gitlane_transactions.json");
}

function cacheFilePath(dir: string) {
  return joinPath(dir, ".git", "gitlane_cache.json");
}

async function readTransactions(dir: string): Promise<TransactionEntry[]> {
  try {
    const raw = await fs.promises.readFile(txFilePath(dir), "utf8");
    return JSON.parse(raw as string) as TransactionEntry[];
  } catch {
    return [];
  }
}

async function writeTransactions(dir: string, entries: TransactionEntry[]) {
  await fs.promises.writeFile(
    txFilePath(dir),
    JSON.stringify(entries, null, 2),
    "utf8",
  );
  console.log(TAG, `TX log updated â†’ ${entries.length} entries`);
}

async function appendTx(dir: string, entry: TransactionEntry) {
  const list = await readTransactions(dir);
  list.push(entry);
  await writeTransactions(dir, list);
}

async function completeTx(dir: string, txId: string) {
  const list = await readTransactions(dir);
  const idx = list.findIndex((e) => e.id === txId);
  if (idx !== -1) {
    list[idx].status = "COMPLETED";
    list[idx].completedAt = Date.now();
  }
  await writeTransactions(dir, list);
}

async function failTx(dir: string, txId: string) {
  const list = await readTransactions(dir);
  const idx = list.findIndex((e) => e.id === txId);
  if (idx !== -1) {
    list[idx].status = "FAILED";
    list[idx].completedAt = Date.now();
  }
  await writeTransactions(dir, list);
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

async function deleteGitCache(dir: string) {
  try {
    await fs.promises.unlink(cacheFilePath(dir));
    console.log(TAG, `Cache deleted â†’ ${cacheFilePath(dir)}`);
  } catch {
    // file didn't exist â€“ fine
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/");
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "just now";
  const diffMs = Date.now() - timestamp * 1000;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function ensureStatus(
  head: number,
  workdir: number,
  stage: number,
): FileStatus {
  if (head === 0 && workdir === 2 && stage === 0) return "untracked";
  if (workdir === 2 && stage === 2) return "staged";
  if (workdir === 2 && stage !== 2) return "modified";
  if (head === 1 && workdir === 0 && stage === 0) return "untracked";
  return "modified";
}

function changeTypeFromStatus(
  head: number,
  workdir: number,
  stage: number,
): ChangeType | undefined {
  if (head === 0 && workdir === 2) return "A";
  if (head === 1 && workdir === 0 && stage === 0) return "D";
  if (stage === 3) return "U";
  if (workdir === 2) return "M";
  return undefined;
}

async function ensureDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function ensureDirDeep(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function removeDir(dir: string) {
  // ExpoFS rmdir deletes recursively — propagate errors to caller
  await fs.promises.rmdir(dir);
}

// ---------------------------------------------------------------------------
// Reflog helpers  (stored in .git/gitlane_reflog.json)
// ---------------------------------------------------------------------------

export interface ReflogEntry {
  id: string;
  ref: string;           // e.g. "HEAD", "refs/heads/main"
  oldOid: string;        // previous sha (0000000 for initial)
  newOid: string;        // new sha
  action: "commit" | "checkout" | "merge" | "branch" | "revert" | "reset";
  message: string;
  author: string;
  timestamp: number;     // Date.now()
}

function reflogFilePath(dir: string) {
  return joinPath(dir, ".git", "gitlane_reflog.json");
}

async function readReflog(dir: string): Promise<ReflogEntry[]> {
  try {
    const raw = await fs.promises.readFile(reflogFilePath(dir), "utf8");
    return JSON.parse(raw as string) as ReflogEntry[];
  } catch {
    return [];
  }
}

async function writeReflog(dir: string, entries: ReflogEntry[]) {
  await fs.promises.writeFile(reflogFilePath(dir), JSON.stringify(entries), "utf8");
}

async function appendReflogEntry(
  dir: string,
  entry: Omit<ReflogEntry, "id" | "timestamp">,
) {
  const entries = await readReflog(dir);
  entries.unshift({
    ...entry,
    id: randomId(),
    timestamp: Date.now(),
  });
  // Keep last 500 entries
  if (entries.length > 500) entries.length = 500;
  await writeReflog(dir, entries);
}


export class GitEngine {
  private ready: Promise<void> | null = null;

  async init() {
    if (!this.ready) {
      this.ready = this.bootstrap();
    }
    return this.ready;
  }

  private async bootstrap() {
    console.log(TAG, `Bootstrapping â€“ BASE_DIR = ${BASE_DIR}`);
    await ensureDirDeep(BASE_DIR);
    console.log(TAG, "Bootstrap complete âœ“");
  }

  // Demo seeding removed

  resolveRepoDir(name: string) {
    return joinPath(BASE_DIR, name);
  }

  // â”€â”€ Clone â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async cloneRepo(
    url: string,
    name: string,
    onProgress?: (phase: string, loaded: number, total: number) => void,
    token?: string,
  ): Promise<Repository> {
    await this.init();
    const safeName = name.trim().replace(/\s+/g, "-");
    const dir = this.resolveRepoDir(safeName);
    const txId = randomId();
    console.log(TAG, `clone START â†’ ${url} into ${dir}`);

    await ensureDirDeep(dir);
    await git.init({ fs, dir }); // need .git before we can write tx log

    await appendTx(dir, {
      id: txId,
      type: "clone",
      status: "PENDING",
      message: url,
      startedAt: Date.now(),
    });

    try {
      await git.clone({
        fs,
        http,
        dir,
        url,
        singleBranch: true,
        depth: 50,
        onAuth: token ? () => ({ username: token, password: "" }) : undefined,
        onProgress: onProgress
          ? (evt) => onProgress(evt.phase, evt.loaded, evt.total ?? 0)
          : undefined,
      });
      await completeTx(dir, txId);
      await deleteGitCache(dir);
      console.log(TAG, `clone COMPLETE â†’ ${safeName}`);
      return this.buildRepository(safeName, dir);
    } catch (err) {
      await failTx(dir, txId);
      console.error(TAG, `clone FAILED â†’ ${safeName}`, err);
      throw err;
    }
  }

  async push(
    repoId: string,
    token: string,
    branch?: string,
    author?: { name: string; email: string },
  ): Promise<{ clean: true } | { clean: false; mergeState: MergeState }> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);

    // Check that a remote exists before attempting push
    const remotes = await git.listRemotes({ fs, dir });
    if (remotes.length === 0) {
      throw new Error(
        "No remote configured. Add a remote (e.g. origin) before pushing.",
      );
    }

    const ref =
      branch ??
      (await git.currentBranch({ fs, dir, fullname: false })) ??
      "main";
    const txId = randomId();
    await appendTx(dir, {
      id: txId,
      type: "push",
      status: "PENDING",
      message: `push ${ref}`,
      startedAt: Date.now(),
    });
    try {
      await git.push({
        fs,
        http,
        dir,
        remote: "origin",
        ref,
        onAuth: () => ({ username: token, password: "" }),
      });
      await completeTx(dir, txId);
      await deleteGitCache(dir);
      console.log(TAG, `push COMPLETE -> ${repoId} (${ref})`);
      return { clean: true };
    } catch (err: any) {
      // ── PushRejectedError: remote has diverged — pull first, then retry ──
      const isPushRejected =
        err?.code === 'PushRejectedError' ||
        (err?.message && err.message.includes('not a simple fast-forward'));

      if (!isPushRejected) {
        await failTx(dir, txId);
        console.error(TAG, `push FAILED -> ${repoId}`, err);
        throw err;
      }

      console.log(TAG, `push rejected (not fast-forward) — pulling first, then retrying…`);

      // 1. Fetch remote changes
      try {
        await git.fetch({
          fs,
          http,
          dir,
          remote: "origin",
          ref,
          singleBranch: true,
          onAuth: () => ({ username: token, password: "" }),
        });
      } catch (fetchErr) {
        await failTx(dir, txId);
        console.error(TAG, `push→fetch FAILED -> ${repoId}`, fetchErr);
        throw fetchErr;
      }

      // 2. Merge remote into local (with conflict detection)
      const mergeAuthor = author ?? { name: "GitLane User", email: "user@gitlane.app" };
      const theirRef = `remotes/origin/${ref}`;

      // Update the tx message so RecoveryAlert can detect merge-in-progress
      await appendTx(dir, {
        id: txId,
        type: "merge",
        status: "PENDING",
        message: `MERGE_IN_PROGRESS: ${ref} <- ${theirRef} (push sync)`,
        startedAt: Date.now(),
      });

      let mergeClean = false;
      try {
        const mergeResult = await git.merge({
          fs,
          dir,
          ours: ref,
          theirs: theirRef,
          author: mergeAuthor,
          abortOnConflict: false,
        });

        if (mergeResult.oid && !mergeResult.alreadyMerged) {
          await git.checkout({ fs, dir, ref, force: true });
          mergeClean = true;
        } else if (mergeResult.alreadyMerged) {
          mergeClean = true;
        }
      } catch (mergeErr: any) {
        const isConflict =
          mergeErr?.code === 'MergeConflictError' ||
          mergeErr?.code === 'MergeNotSupportedError' ||
          (mergeErr?.message && mergeErr.message.includes('onflict'));
        const isUnmerged =
          mergeErr?.code === 'UnmergedPathsError' ||
          (mergeErr?.message && mergeErr.message.includes('nmerged'));

        if (isConflict) {
          console.log(TAG, `push→merge detected conflicts — entering resolution mode`);
          const conflictResult = await this.handleMergeConflicts(dir, repoId, ref, theirRef, txId);
          return conflictResult;
        }

        if (isUnmerged) {
          // Leftover unmerged entries from a previous merge — force-checkout to clean up, then retry
          console.warn(TAG, `push→merge hit UnmergedPathsError — cleaning up & retrying`);
          try {
            await git.checkout({ fs, dir, ref, force: true });
            try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_HEAD')); } catch {}
            try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_MSG')); } catch {}

            const retryResult = await git.merge({
              fs, dir, ours: ref, theirs: theirRef,
              author: mergeAuthor, abortOnConflict: false,
            });
            if (retryResult.oid && !retryResult.alreadyMerged) {
              await git.checkout({ fs, dir, ref, force: true });
              // Retry push after clean merge
              await git.push({
                fs, http, dir, remote: 'origin', ref,
                onAuth: () => ({ username: token, password: '' }),
              });
              await completeTx(dir, txId);
              await deleteGitCache(dir);
              console.log(TAG, `push COMPLETE (after unmerged cleanup) -> ${repoId} (${ref})`);
              return { clean: true };
            }
            // Still has conflicts after retry
            const conflictResult = await this.handleMergeConflicts(dir, repoId, ref, theirRef, txId);
            return conflictResult;
          } catch (cleanupErr) {
            console.error(TAG, `push→merge cleanup retry also failed`, cleanupErr);
          }
        }

        await failTx(dir, txId);
        console.error(TAG, `push→merge FAILED -> ${repoId}`, mergeErr);
        throw mergeErr;
      }

      if (!mergeClean) {
        // Merge wasn't clean but no error was thrown — check for conflict markers
        const conflictResult = await this.handleMergeConflicts(dir, repoId, ref, theirRef, txId);
        if (conflictResult.mergeState.conflicts.length > 0) {
          return conflictResult;
        }
      }

      // 3. Merge was clean — retry push
      try {
        await git.push({
          fs,
          http,
          dir,
          remote: "origin",
          ref,
          onAuth: () => ({ username: token, password: "" }),
        });
        await completeTx(dir, txId);
        await deleteGitCache(dir);
        console.log(TAG, `push COMPLETE (after pull-merge) -> ${repoId} (${ref})`);
        return { clean: true };
      } catch (retryErr) {
        await failTx(dir, txId);
        console.error(TAG, `push (retry) FAILED -> ${repoId}`, retryErr);
        throw retryErr;
      }
    }
  }

  async pull(
    repoId: string,
    token: string,
    branch?: string,
    author?: { name: string; email: string },
  ): Promise<{ clean: true } | { clean: false; mergeState: MergeState }> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);

    const remotes = await git.listRemotes({ fs, dir });
    if (remotes.length === 0) {
      throw new Error(
        "No remote configured. Add a remote (e.g. origin) before pulling.",
      );
    }

    const ref =
      branch ??
      (await git.currentBranch({ fs, dir, fullname: false })) ??
      "main";
    const txId = randomId();
    await appendTx(dir, {
      id: txId,
      type: "pull",
      status: "PENDING",
      message: `pull ${ref}`,
      startedAt: Date.now(),
    });
    try {
      await git.fetch({
        fs,
        http,
        dir,
        remote: "origin",
        ref,
        singleBranch: true,
        onAuth: () => ({ username: token, password: "" }),
      });

      const mergeAuthor = author ?? { name: "GitLane User", email: "user@gitlane.app" };
      const theirRef = `remotes/origin/${ref}`;

      let mergeClean = false;
      try {
        const mergeResult = await git.merge({
          fs,
          dir,
          ours: ref,
          theirs: theirRef,
          author: mergeAuthor,
          abortOnConflict: false,
        });

        if (mergeResult.oid && !mergeResult.alreadyMerged) {
          await git.checkout({ fs, dir, ref, force: true });
          mergeClean = true;
        } else if (mergeResult.alreadyMerged) {
          mergeClean = true;
        }
      } catch (mergeErr: any) {
        const isConflict =
          mergeErr?.code === 'MergeConflictError' ||
          mergeErr?.code === 'MergeNotSupportedError' ||
          (mergeErr?.message && mergeErr.message.includes('onflict'));
        const isUnmerged =
          mergeErr?.code === 'UnmergedPathsError' ||
          (mergeErr?.message && mergeErr.message.includes('nmerged'));

        if (isConflict) {
          console.log(TAG, `pull→merge detected conflicts — entering resolution mode`);
          await appendTx(dir, {
            id: txId,
            type: "merge",
            status: "PENDING",
            message: `MERGE_IN_PROGRESS: ${ref} <- ${theirRef} (pull)`,
            startedAt: Date.now(),
          });
          return await this.handleMergeConflicts(dir, repoId, ref, theirRef, txId);
        }

        if (isUnmerged) {
          // Leftover unmerged entries from a previous merge — clean up & retry
          console.warn(TAG, `pull→merge hit UnmergedPathsError — cleaning up & retrying`);
          try {
            await git.checkout({ fs, dir, ref, force: true });
            try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_HEAD')); } catch {}
            try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_MSG')); } catch {}

            const retryResult = await git.merge({
              fs, dir, ours: ref, theirs: theirRef,
              author: mergeAuthor, abortOnConflict: false,
            });
            if (retryResult.oid && !retryResult.alreadyMerged) {
              await git.checkout({ fs, dir, ref, force: true });
              mergeClean = true;
            } else if (retryResult.alreadyMerged) {
              mergeClean = true;
            }
            // If still not clean, fall through to the !mergeClean check below
          } catch (cleanupErr: any) {
            const isRetryConflict =
              cleanupErr?.code === 'MergeConflictError' ||
              cleanupErr?.code === 'MergeNotSupportedError' ||
              (cleanupErr?.message && cleanupErr.message.includes('onflict'));
            if (isRetryConflict) {
              console.log(TAG, `pull→merge retry detected conflicts`);
              await appendTx(dir, {
                id: txId, type: "merge", status: "PENDING",
                message: `MERGE_IN_PROGRESS: ${ref} <- ${theirRef} (pull)`,
                startedAt: Date.now(),
              });
              return await this.handleMergeConflicts(dir, repoId, ref, theirRef, txId);
            }
            throw cleanupErr;
          }
        }

        if (!isConflict && !isUnmerged) {
          throw mergeErr; // re-throw non-conflict/non-unmerged errors to outer catch
        }
      }

      if (!mergeClean) {
        // Merge didn't throw but also didn't produce a clean result — check for conflict markers
        await appendTx(dir, {
          id: txId,
          type: "merge",
          status: "PENDING",
          message: `MERGE_IN_PROGRESS: ${ref} <- ${theirRef} (pull)`,
          startedAt: Date.now(),
        });
        const conflictResult = await this.handleMergeConflicts(dir, repoId, ref, theirRef, txId);
        if (conflictResult.mergeState.conflicts.length > 0) {
          return conflictResult;
        }
      }

      // Checkout to update the working directory
      await git.checkout({ fs, dir, ref });
      await completeTx(dir, txId);
      await deleteGitCache(dir);
      console.log(TAG, `pull COMPLETE -> ${repoId} (${ref})`);
      return { clean: true };
    } catch (err) {
      await failTx(dir, txId);
      console.error(TAG, `pull FAILED -> ${repoId}`, err);
      throw err;
    }
  }

  // -- Remotes --------------------------------------------------------

  async addRemote(
    repoId: string,
    remoteName: string,
    url: string,
  ): Promise<void> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);

    // Remove existing remote with same name (if any) before adding
    const existing = await git.listRemotes({ fs, dir });
    if (existing.some((r) => r.remote === remoteName)) {
      await git.deleteRemote({ fs, dir, remote: remoteName });
    }

    await git.addRemote({ fs, dir, remote: remoteName, url });
    console.log(TAG, `addRemote(${repoId}) -> ${remoteName} = ${url}`);
  }

  async getRemotes(repoId: string): Promise<{ remote: string; url: string }[]> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    return git.listRemotes({ fs, dir });
  }

  // -- List -----------------------------------------------------------
  async listRepositories(): Promise<Repository[]> {
    await this.init();
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(BASE_DIR);
    } catch (err) {
      console.warn(TAG, "listRepositories: readdir failed", err);
      return [];
    }
    const repos: Repository[] = [];
    console.log(
      TAG,
      `listRepositories â€“ scanning ${BASE_DIR}, found: [${entries.join(
        ", ",
      )}]`,
    );

    for (const name of entries) {
      const dir = this.resolveRepoDir(name);
      const hasGit = await fs.promises
        .stat(joinPath(dir, ".git"))
        .catch(() => null);
      if (!hasGit) continue;
      try {
        const repo = await this.buildRepository(name, dir);
        repos.push(repo);
      } catch (err) {
        console.warn(
          TAG,
          `listRepositories: buildRepository("${name}") failed`,
          err,
        );
      }
    }

    // newest first by last activity
    return repos.sort((a, b) => (a.lastActivity > b.lastActivity ? -1 : 1));
  }

  private async buildRepository(
    name: string,
    dir: string,
  ): Promise<Repository> {
    let currentBranch: string;
    try {
      currentBranch =
        (await git.currentBranch({ fs, dir, fullname: false })) ?? "main";
    } catch {
      // HEAD may point to a non-existent ref (empty repo or mismatched default branch)
      currentBranch = "main";
    }

    const branches = await git.listBranches({ fs, dir });
    const branchMeta: GitBranch[] = await Promise.all(
      branches.map(async (branch) => {
        try {
          const head = (await git.log({ fs, dir, ref: branch, depth: 1 }))[0];
          return {
            name: branch,
            isRemote: false,
            isCurrent: branch === currentBranch,
            lastCommitSha: head?.oid ?? "",
            lastCommitMessage: head?.commit.message ?? "",
            ahead: 0,
            behind: 0,
          };
        } catch {
          // Branch ref exists but has no commits yet
          return {
            name: branch,
            isRemote: false,
            isCurrent: branch === currentBranch,
            lastCommitSha: "",
            lastCommitMessage: "",
            ahead: 0,
            behind: 0,
          };
        }
      }),
    );

    let statusMatrix: [string, number, number, number][] = [];
    try {
      statusMatrix = await git.statusMatrix({ fs, dir });
    } catch {
      // Empty repo with no commits can't produce a status matrix
    }
    const stagedCount = statusMatrix.filter(
      ([, , , stage]) => stage === 2 || stage === 3,
    ).length;
    const modifiedCount = statusMatrix.filter(
      ([, , workdir, stage]) => workdir === 2 && stage !== 2,
    ).length;
    const conflictCount = statusMatrix.filter(
      ([, , , stage]) => stage === 3,
    ).length;

    let latestCommit: Awaited<ReturnType<typeof git.log>>[0] | undefined;
    let commitCount = 0;
    try {
      const logs = await git.log({ fs, dir });
      latestCommit = logs[0];
      commitCount = logs.length;
    } catch {
      // No commits yet
    }
    const lastActivity = formatTimestamp(latestCommit?.commit.author.timestamp);

    console.log(
      TAG,
      `buildRepo(${name}) â€“ branch=${currentBranch} commits=${commitCount} staged=${stagedCount} modified=${modifiedCount}`,
    );

    return {
      id: name,
      name,
      path: dir,
      currentBranch,
      branches: branchMeta,
      stagedCount,
      modifiedCount,
      conflictCount,
      lastActivity,
      size: "â€”",
      commitCount,
    };
  }

  async getWorkingTree(repoId: string): Promise<GitFile[]> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    console.log(TAG, `getWorkingTree(${repoId})`);
    const statusMatrix = await git.statusMatrix({ fs, dir });
    const tracked = await git.listFiles({ fs, dir });

    // Also scan the filesystem recursively to catch brand-new untracked files
    const fsFiles = await this.listAllFiles(dir, '');
    const all = Array.from(
      new Set([
        ...tracked,
        ...statusMatrix.map(([filepath]) => filepath),
        ...fsFiles,
      ]),
    ).filter(f => !f.startsWith('.git/') && f !== '.git');

    const tree: GitFile[] = [];

    for (const filepath of all) {
      const statusEntry = statusMatrix.find(([p]) => p === filepath) ?? null;
      const head = statusEntry?.[1] ?? 0;
      const workdir = statusEntry?.[2] ?? 0;
      const stage = statusEntry?.[3] ?? 0;
      const status = ensureStatus(head, workdir, stage);
      const changeType = changeTypeFromStatus(head, workdir, stage);

      const fullPath = joinPath(dir, filepath);
      const stat = await fs.promises.stat(fullPath).catch(() => null);
      const isDirectory = stat?.type === "dir";
      const size = stat?.size ?? 0;
      const segments = filepath.split("/");
      const fileName = segments[segments.length - 1];
      const extension = fileName.includes(".")
        ? fileName.split(".").pop()
        : undefined;

      let content: string | undefined;
      if (!isDirectory) {
        try {
          const buf = await fs.promises.readFile(fullPath, "utf8");
          content = buf as string;
        } catch (_) {
          content = undefined;
        }
      }

      const fileNode: GitFile = {
        id: filepath,
        name: fileName,
        path: "/" + filepath,
        isDirectory: isDirectory ?? false,
        size,
        extension,
        status,
        changeType,
        modifiedAt: undefined,
        content,
      };

      this.insertIntoTree(tree, segments, fileNode);
    }

    return tree;
  }

  private insertIntoTree(tree: GitFile[], segments: string[], file: GitFile) {
    if (segments.length === 0) return;
    const [head, ...rest] = segments;
    if (rest.length === 0) {
      const existingIndex = tree.findIndex((f) => f.name === head);
      if (existingIndex !== -1) {
        tree[existingIndex] = { ...tree[existingIndex], ...file };
      } else {
        tree.push(file);
      }
      return;
    }

    let dirNode = tree.find((f) => f.name === head && f.isDirectory);
    if (!dirNode) {
      dirNode = {
        id: randomId(),
        name: head,
        path: "/" + segments.slice(0, segments.length - rest.length).join("/"),
        isDirectory: true,
        children: [],
      };
      tree.push(dirNode);
    }
    if (!dirNode.children) dirNode.children = [];
    this.insertIntoTree(dirNode.children, rest, file);
  }

  /**
   * Recursively list all files under `dir`, returning paths relative to `dir`.
   * Skips the .git directory.
   */
  private async listAllFiles(baseDir: string, prefix: string): Promise<string[]> {
    const results: string[] = [];
    let entries: string[] = [];
    const target = prefix ? joinPath(baseDir, prefix) : baseDir;
    try {
      entries = await fs.promises.readdir(target);
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (entry === '.git') continue;
      const relPath = prefix ? `${prefix}/${entry}` : entry;
      const fullPath = joinPath(baseDir, relPath);
      const stat = await fs.promises.stat(fullPath).catch(() => null);
      if (!stat) continue;
      if (stat.type === 'dir') {
        const children = await this.listAllFiles(baseDir, relPath);
        results.push(...children);
      } else {
        results.push(relPath);
      }
    }
    return results;
  }

  async getCommits(repoId: string): Promise<GitCommit[]> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    const commits = await git.log({ fs, dir, depth: 50 });
    console.log(TAG, `getCommits(${repoId}) -> ${commits.length} commits`);

    // Build branch -> oid map so we can tag commits with branch names
    const branchMap = new Map<string, string[]>();
    try {
      const localBranches = await git.listBranches({ fs, dir });
      for (const b of localBranches) {
        try {
          const oid = await git.resolveRef({ fs, dir, ref: b });
          const existing = branchMap.get(oid) ?? [];
          existing.push(b);
          branchMap.set(oid, existing);
        } catch { /* skip unresolvable branch */ }
      }
      // Also mark HEAD
      try {
        const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
        const existing = branchMap.get(headOid) ?? [];
        if (!existing.includes('HEAD')) {
          existing.push('HEAD');
          branchMap.set(headOid, existing);
        }
      } catch { /* skip */ }
    } catch { /* skip */ }

    // Compute per-commit stats in parallel batches for performance
    const BATCH_SIZE = 5;
    const results: GitCommit[] = [];

    for (let i = 0; i < commits.length; i += BATCH_SIZE) {
      const batch = commits.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (entry) => {
          const parents = entry.commit.parent ?? [];
          let filesChanged = 0;
          let additions = 0;
          let deletions = 0;
          let files: import('@/types/git').CommitFile[] = [];

          try {
            const stats = await this.getCommitStats(dir, entry.oid, parents[0] ?? null);
            filesChanged = stats.filesChanged;
            additions = stats.additions;
            deletions = stats.deletions;
            files = stats.files;
          } catch (err) {
            console.warn(TAG, `getCommits -> stats failed for ${entry.oid.slice(0, 7)}:`, err);
          }

          return {
            sha: entry.oid,
            shortSha: entry.oid.slice(0, 7),
            message: entry.commit.message,
            author: entry.commit.author.name,
            email: entry.commit.author.email,
            date: formatTimestamp(entry.commit.author.timestamp),
            parents,
            branches: branchMap.get(entry.oid) ?? [],
            isMerge: parents.length > 1,
            filesChanged,
            additions,
            deletions,
            files,
          };
        }),
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Compute file-change stats for a single commit by walking its tree
   * against its parent tree. Compares blob OIDs to find changed files,
   * then does a line-level LCS diff for accurate additions/deletions.
   *
   * CRITICAL: The git.walk `map` callback MUST return `undefined` (bare
   * `return`) for root (".") and tree/directory entries so isomorphic-git
   * recurses into subdirectories. Returning `null` stops recursion.
   */
  private async getCommitStats(
    dir: string,
    commitOid: string,
    parentOid: string | null,
  ): Promise<{ filesChanged: number; additions: number; deletions: number; files: import('@/types/git').CommitFile[] }> {
    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;
    const files: import('@/types/git').CommitFile[] = [];

    const decodeBlob = async (entry: WalkerEntry | null): Promise<string> => {
      if (!entry) return '';
      try {
        const bytes = await entry.content();
        if (!bytes) return '';
        return new TextDecoder().decode(bytes as Uint8Array);
      } catch { return ''; }
    };

    const countLines = (text: string): number => {
      if (!text) return 0;
      return text.split('\n').length;
    };

    /**
     * Compute added/deleted line counts between two file versions using
     * a simple LCS (longest common subsequence) approach. Falls back to
     * a fast heuristic for very large files to stay responsive on mobile.
     */
    const computeLineDiff = (oldText: string, newText: string): { add: number; del: number } => {
      const oldLines = oldText ? oldText.split('\n') : [];
      const newLines = newText ? newText.split('\n') : [];
      const m = oldLines.length;
      const n = newLines.length;

      // Fast heuristic for large files (> 1000 combined lines)
      if (m + n > 1000) {
        const common = Math.min(m, n);
        let same = 0;
        for (let i = 0; i < common; i++) {
          if (oldLines[i] === newLines[i]) same++;
        }
        return { add: Math.max(1, n - same), del: Math.max(1, m - same) };
      }

      // LCS via DP for accurate diff
      const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = oldLines[i - 1] === newLines[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
      const lcs = dp[m][n];
      return { add: Math.max(0, n - lcs), del: Math.max(0, m - lcs) };
    };

    if (!parentOid) {
      // Initial commit: every file is an addition
      await git.walk({
        fs,
        dir,
        trees: [git.TREE({ ref: commitOid })],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map: async (filepath: string, entries: any[]) => {
          const entry: WalkerEntry | null = entries[0];
          // Return undefined for root & trees so walk recurses into children
          if (filepath === '.') return;
          const type = await entry?.type();
          if (type !== 'blob') return;  // tree → recurse; missing → skip
          filesChanged++;
          const content = await decodeBlob(entry);
          const lines = countLines(content);
          additions += lines;
          files.push({ path: filepath, changeType: 'A', additions: lines, deletions: 0 });
          return filepath; // collect (value doesn't matter, just not null)
        },
      });
    } else {
      // Normal commit: compare parent tree vs current tree by blob OID
      await git.walk({
        fs,
        dir,
        trees: [git.TREE({ ref: parentOid }), git.TREE({ ref: commitOid })],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map: async (filepath: string, entries: any[]) => {
          const parentEntry: WalkerEntry | null = entries[0];
          const currentEntry: WalkerEntry | null = entries[1];
          // Return undefined for root so walk recurses into the whole tree
          if (filepath === '.') return;

          const [pType, cType] = await Promise.all([
            parentEntry?.type(),
            currentEntry?.type(),
          ]);
          // If either side is a directory, return undefined to recurse into it
          if (pType === 'tree' || cType === 'tree') return;

          const [pOid, cOid] = await Promise.all([
            parentEntry?.oid(),
            currentEntry?.oid(),
          ]);
          // Unchanged file: skip
          if (pOid && cOid && pOid === cOid) return null;

          filesChanged++;

          // Read content for line-level diff
          const [oldContent, newContent] = await Promise.all([
            decodeBlob(parentEntry ?? null),
            decodeBlob(currentEntry ?? null),
          ]);

          let fileAdd = 0;
          let fileDel = 0;
          let changeType: import('@/types/git').ChangeType = 'M';

          if (!pOid) {
            // Added file
            changeType = 'A';
            fileAdd = countLines(newContent);
          } else if (!cOid) {
            // Deleted file
            changeType = 'D';
            fileDel = countLines(oldContent);
          } else {
            // Modified: compute real line diff
            changeType = 'M';
            const diff = computeLineDiff(oldContent, newContent);
            fileAdd = diff.add;
            fileDel = diff.del;
          }

          additions += fileAdd;
          deletions += fileDel;
          files.push({ path: filepath, changeType, additions: fileAdd, deletions: fileDel });

          return filepath;
        },
      });
    }

    return { filesChanged, additions, deletions, files };
  }

  // ── getCommitDiff ────────────────────────────────────────────────────────
  // Returns file-level diff data (old blob + new blob) for a single commit.
  // Uses isomorphic-git tree walkers to read actual file content from the
  // object store — no working directory access required.

  async getCommitDiff(repoId: string, sha: string): Promise<CommitDiffFile[]> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);

    // Get the commit's parent(s) — limit depth:2 to keep it fast
    const log = await git.log({ fs, dir, ref: sha, depth: 2 });
    const parentSha = log[1]?.oid ?? null;

    const decode = async (entry: WalkerEntry | null): Promise<string> => {
      if (!entry) return "";
      try {
        const bytes = await entry.content();
        if (!bytes) return "";
        return new TextDecoder().decode(bytes as Uint8Array);
      } catch {
        return "";
      }
    };

    if (!parentSha) {
      // Initial commit — every file in the tree is "added"
      const results: CommitDiffFile[] = [];
      await git.walk({
        fs,
        dir,
        trees: [git.TREE({ ref: sha })],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map: async (filepath: string, entries: any[]) => {
          const entry: WalkerEntry | null = entries[0];
          if (filepath === ".") return null;
          const type = await entry?.type();
          if (type !== "blob") return null;
          const newContent = await decode(entry);
          results.push({
            filepath,
            oldContent: "",
            newContent,
            changeType: "A",
          });
          return null;
        },
      });
      return results;
    }

    // Normal commit — compare parent tree vs current tree
    type RawEntry = CommitDiffFile | null;
    const walked = ((await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref: parentSha }), git.TREE({ ref: sha })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map: async (filepath: string, entries: any[]): Promise<RawEntry> => {
        const parentEntry: WalkerEntry | null = entries[0];
        const currentEntry: WalkerEntry | null = entries[1];
        if (filepath === ".") return null;

        const [parentType, currentType] = await Promise.all([
          parentEntry?.type(),
          currentEntry?.type(),
        ]);
        // Skip directory nodes
        if (parentType === "tree" || currentType === "tree") return null;

        const [parentOid, currentOid] = await Promise.all([
          parentEntry?.oid(),
          currentEntry?.oid(),
        ]);
        // Skip unchanged files
        if (parentOid && currentOid && parentOid === currentOid) return null;

        const [oldContent, newContent] = await Promise.all([
          decode(parentEntry ?? null),
          decode(currentEntry ?? null),
        ]);

        const changeType: "M" | "A" | "D" = !parentEntry
          ? "A"
          : !currentEntry
            ? "D"
            : "M";

        return { filepath, oldContent, newContent, changeType };
      },
    })) ?? []) as RawEntry[];

    return walked.filter((r): r is CommitDiffFile => r !== null);
  }

  // ── getRemoteUrl ─────────────────────────────────────────────────────────
  // Reads the 'remote.origin.url' git config value for a repo.
  // Returns null if the repo has no remote (locally created repos).

  async getRemoteUrl(repoId: string): Promise<string | null> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    try {
      const url = await git.getConfig({ fs, dir, path: "remote.origin.url" });
      return (url as string | undefined) ?? null;
    } catch {
      return null;
    }
  }

  async createRepository(
    name: string,
    addReadme: boolean,
  ): Promise<Repository> {
    await this.init();
    const safeName = name.trim().replace(/\s+/g, "-");
    const dir = this.resolveRepoDir(safeName);
    console.log(TAG, `createRepository(${safeName}) â†’ ${dir}`);
    await ensureDirDeep(dir);
    await git.init({ fs, dir });

    if (addReadme) {
      await fs.promises.writeFile(joinPath(dir, "README.md"), `# ${name}\n`);
      await git.add({ fs, dir, filepath: "README.md" });
      await git.commit({
        fs,
        dir,
        message: "chore: initial commit",
        author: { name: "GitLane User", email: "user@gitlane.app" },
        committer: { name: "GitLane User", email: "user@gitlane.app" },
      });
    }

    return this.buildRepository(safeName, dir);
  }

  async deleteRepository(id: string) {
    const dir = this.resolveRepoDir(id);
    console.log(TAG, `deleteRepository(${id}) → removing ${dir}`);
    try {
      await removeDir(dir);
      console.log(TAG, `deleteRepository(${id}) → removed successfully`);
    } catch (err) {
      console.error(TAG, `deleteRepository(${id}) → removeDir failed`, err);
      throw new Error(
        `Failed to delete repository "${id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // â”€â”€ Stage / Unstage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async stageFile(repoId: string, filepath: string) {
    const dir = this.resolveRepoDir(repoId);
    console.log(TAG, `stage ${filepath} in ${repoId}`);
    await git.add({ fs, dir, filepath });
  }

  async unstageFile(repoId: string, filepath: string) {
    const dir = this.resolveRepoDir(repoId);
    console.log(TAG, `unstage ${filepath} in ${repoId}`);
    await git.resetIndex({ fs, dir, filepath });
  }
  // ── Create / Delete files ─────────────────────────────────────────────────

  async createFile(repoId: string, filepath: string, content: string = ''): Promise<void> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    const fullPath = joinPath(dir, filepath);

    // Ensure parent directories exist
    const segments = filepath.split('/');
    if (segments.length > 1) {
      const parentDir = joinPath(dir, ...segments.slice(0, -1));
      await ensureDirDeep(parentDir);
    }

    await fs.promises.writeFile(fullPath, content, 'utf8');
    await deleteGitCache(dir);
    console.log(TAG, `createFile(${repoId}) → ${filepath}`);
  }

  async deleteFile(repoId: string, filepath: string): Promise<void> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    const fullPath = joinPath(dir, filepath);

    // Remove from git index first
    try {
      await git.remove({ fs, dir, filepath });
    } catch {
      // Not tracked — that's fine
    }

    // Remove from filesystem
    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.type === 'dir') {
        await removeDir(fullPath);
      } else {
        await fs.promises.unlink(fullPath);
      }
    } catch {
      // File might already be gone
    }

    await deleteGitCache(dir);
    console.log(TAG, `deleteFile(${repoId}) → ${filepath}`);
  }

  /**
   * Save (overwrite) file content on disk without committing.
   */
  async saveFile(repoId: string, filepath: string, content: string): Promise<void> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    const fullPath = joinPath(dir, filepath);
    await fs.promises.writeFile(fullPath, content, 'utf8');
    await deleteGitCache(dir);
    console.log(TAG, `saveFile(${repoId}) → ${filepath}`);
  }

  /**
   * Revert a file to the version in the last commit (HEAD).
   * Also resets the index entry so it doesn't show as staged.
   */
  async revertFile(repoId: string, filepath: string): Promise<void> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    const fullPath = joinPath(dir, filepath);

    try {
      // Read the file content from HEAD
      const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
      const { blob } = await git.readBlob({ fs, dir, oid: headOid, filepath });
      const originalContent = new TextDecoder().decode(blob);
      await fs.promises.writeFile(fullPath, originalContent, 'utf8');
      // Also restore the index
      await git.resetIndex({ fs, dir, filepath });
      await deleteGitCache(dir);
      console.log(TAG, `revertFile(${repoId}) → ${filepath} restored from HEAD`);
    } catch (err) {
      // If the file doesn't exist in HEAD (new file), just delete it
      try {
        await fs.promises.unlink(fullPath);
      } catch { /* already gone */ }
      try {
        await git.remove({ fs, dir, filepath });
      } catch { /* not in index */ }
      await deleteGitCache(dir);
      console.log(TAG, `revertFile(${repoId}) → ${filepath} removed (not in HEAD)`);
    }
  }

  // ── Reflog ─────────────────────────────────────────────────────────────

  /**
   * Get the reflog for a repository.
   * Returns entries in reverse chronological order (newest first).
   */
  async getReflog(repoId: string): Promise<ReflogEntry[]> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);
    return readReflog(dir);
  }

  // ── Revert to Commit ──────────────────────────────────────────────────

  /**
   * Revert the repository working tree to the state of a specific commit.
   * This creates a NEW commit whose tree matches the target commit exactly,
   * preserving full history (no destructive reset).
   */
  async revertToCommit(
    repoId: string,
    targetSha: string,
    author: { name: string; email: string },
  ): Promise<string> {
    await this.init();
    const dir = this.resolveRepoDir(repoId);

    let oldOid = '0000000';
    try { oldOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}

    // 1. Read the tree of the target commit
    const { commit: targetCommit } = await git.readCommit({ fs, dir, oid: targetSha });
    const targetTree = targetCommit.tree;

    // 2. Remove all tracked files from the working directory
    const allFiles = await this.listAllFiles(dir, '');
    for (const filepath of allFiles) {
      const fullPath = joinPath(dir, filepath);
      try {
        await fs.promises.unlink(fullPath);
      } catch { /* ignore */ }
    }

    // 3. Checkout the target tree into the working directory
    //    We use git.readTree + manually write files from the target commit
    await this.writeTreeToWorkdir(dir, targetTree, '');

    // 4. Stage all changes
    const currentFiles = await this.listAllFiles(dir, '');
    for (const filepath of currentFiles) {
      await git.add({ fs, dir, filepath });
    }

    // Also stage deletions for any files that were in HEAD but not in the target
    try {
      const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
      const { commit: headCommit } = await git.readCommit({ fs, dir, oid: headOid });
      const headFiles = await this.collectTreePaths(dir, headCommit.tree, '');
      const targetFiles = new Set(currentFiles);
      for (const hf of headFiles) {
        if (!targetFiles.has(hf)) {
          try { await git.remove({ fs, dir, filepath: hf }); } catch {}
        }
      }
    } catch { /* first commit scenario */ }

    // 5. Create a revert commit
    const shortSha = targetSha.slice(0, 7);
    const message = `Revert to ${shortSha}: restored working tree to commit ${targetSha}`;
    const newOid = await git.commit({ fs, dir, message, author, committer: author });

    // 6. Record reflog entry
    await appendReflogEntry(dir, {
      ref: 'HEAD',
      oldOid,
      newOid,
      action: 'revert',
      message: `revert: reverting to ${shortSha}`,
      author: author.name,
    });

    await deleteGitCache(dir);
    console.log(TAG, `revertToCommit(${repoId}) -> reverted to ${shortSha}, new commit ${newOid}`);
    return newOid;
  }

  /**
   * Recursively write a git tree object to the working directory.
   */
  private async writeTreeToWorkdir(dir: string, treeOid: string, prefix: string): Promise<void> {
    const { tree } = await git.readTree({ fs, dir, oid: treeOid });
    for (const entry of tree) {
      const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
      const fullPath = joinPath(dir, entryPath);

      if (entry.mode === '040000' || entry.type === 'tree') {
        // Directory — recurse
        await ensureDir(fullPath);
        await this.writeTreeToWorkdir(dir, entry.oid, entryPath);
      } else {
        // File — read blob and write
        const { blob } = await git.readBlob({ fs, dir, oid: entry.oid });
        const content = new TextDecoder().decode(blob);
        // Ensure parent directory exists
        const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        if (parentDir) await ensureDir(parentDir);
        await fs.promises.writeFile(fullPath, content, 'utf8');
      }
    }
  }

  /**
   * Collect all file paths from a tree object recursively.
   */
  private async collectTreePaths(dir: string, treeOid: string, prefix: string): Promise<string[]> {
    const paths: string[] = [];
    const { tree } = await git.readTree({ fs, dir, oid: treeOid });
    for (const entry of tree) {
      const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.mode === '040000' || entry.type === 'tree') {
        const subPaths = await this.collectTreePaths(dir, entry.oid, entryPath);
        paths.push(...subPaths);
      } else {
        paths.push(entryPath);
      }
    }
    return paths;
  }

  // ── Commit (TX-wrapped) ────────────────────────────────────────────

  async commit(
    repoId: string,
    message: string,
    author: { name: string; email: string },
  ) {
    const dir = this.resolveRepoDir(repoId);
    const txId = randomId();

    // 1. PENDING
    await appendTx(dir, {
      id: txId,
      type: "commit",
      status: "PENDING",
      message,
      startedAt: Date.now(),
    });
    console.log(TAG, `commit PENDING (txId=${txId}) in ${repoId}`);

    try {
      // Capture HEAD before commit for reflog
      let oldOid = '0000000';
      try { oldOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}

      const newCommitOid = await git.commit({ fs, dir, message, author, committer: author });

      // Record reflog entry
      await appendReflogEntry(dir, {
        ref: 'HEAD',
        oldOid,
        newOid: newCommitOid,
        action: 'commit',
        message: `commit: ${message}`,
        author: author.name,
      });

      // 2. COMPLETED + invalidate cache (after short delay for crash-recovery testing)
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await completeTx(dir, txId);
      await deleteGitCache(dir);
      console.log(TAG, `commit COMPLETED (txId=${txId}) in ${repoId}`);
    } catch (err) {
      await failTx(dir, txId);
      console.error(TAG, `commit FAILED (txId=${txId})`, err);
      throw err;
    }
  }

  // â”€â”€ Branch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async switchBranch(repoId: string, branch: string) {
    const dir = this.resolveRepoDir(repoId);
    console.log(TAG, `switchBranch(${repoId}, ${branch})`);

    let oldOid = '0000000';
    try { oldOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}
    const oldBranch = await git.currentBranch({ fs, dir, fullname: false }) ?? 'HEAD';

    await git.checkout({ fs, dir, ref: branch });

    let newOid = '0000000';
    try { newOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}
    await appendReflogEntry(dir, {
      ref: 'HEAD',
      oldOid,
      newOid,
      action: 'checkout',
      message: `checkout: moving from ${oldBranch} to ${branch}`,
      author: 'user',
    });
    await deleteGitCache(dir);
    console.log(TAG, `switchBranch â†’ now on ${branch}`);
  }

  async createBranch(repoId: string, branch: string) {
    const dir = this.resolveRepoDir(repoId);
    const txId = randomId();

    await appendTx(dir, {
      id: txId,
      type: "branch",
      status: "PENDING",
      message: `create ${branch}`,
      startedAt: Date.now(),
    });
    console.log(TAG, `createBranch PENDING (txId=${txId}) â†’ ${branch}`);

    try {
      let oldOid = '0000000';
      try { oldOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}

      await git.branch({ fs, dir, ref: branch, checkout: true });

      let newOid = '0000000';
      try { newOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}
      await appendReflogEntry(dir, {
        ref: 'HEAD',
        oldOid,
        newOid,
        action: 'branch',
        message: `branch: Created ${branch} from HEAD`,
        author: 'user',
      });

      await completeTx(dir, txId);
      await deleteGitCache(dir);
      console.log(TAG, `createBranch COMPLETED â†’ ${branch}`);
    } catch (err) {
      await failTx(dir, txId);
      console.error(TAG, `createBranch FAILED â†’ ${branch}`, err);
      throw err;
    }
  }

  async deleteBranch(repoId: string, branch: string) {
    const dir = this.resolveRepoDir(repoId);
    const txId = randomId();
    await appendTx(dir, {
      id: txId,
      type: "branch",
      status: "PENDING",
      message: `delete ${branch}`,
      startedAt: Date.now(),
    });

    try {
      await git.deleteRef({
        fs,
        dir,
        ref: `refs/heads/${branch}`,
      });
      await completeTx(dir, txId);
      await deleteGitCache(dir);
      console.log(TAG, `deleteBranch COMPLETED â†’ ${branch}`);
    } catch (err) {
      await failTx(dir, txId);
      console.error(TAG, `deleteBranch FAILED â†’ ${branch}`, err);
      throw err;
    }
  }

  async renameBranch(repoId: string, oldName: string, newName: string) {
    const dir = this.resolveRepoDir(repoId);
    const txId = randomId();
    await appendTx(dir, {
      id: txId,
      type: "branch",
      status: "PENDING",
      message: `rename ${oldName} to ${newName}`,
      startedAt: Date.now(),
    });

    try {
      const sha = await git.resolveRef({ fs, dir, ref: `refs/heads/${oldName}` });
      await git.writeRef({
        fs,
        dir,
        ref: `refs/heads/${newName}`,
        value: sha,
        force: true,
      });
      await git.deleteRef({
        fs,
        dir,
        ref: `refs/heads/${oldName}`,
      });
      await completeTx(dir, txId);
      await deleteGitCache(dir);
      console.log(TAG, `renameBranch COMPLETED â†’ ${oldName} to ${newName}`);
    } catch (err) {
      await failTx(dir, txId);
      console.error(TAG, `renameBranch FAILED`, err);
      throw err;
    }
  }


  // â”€â”€ Merge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // ── Merge (conflict-aware) ───────────────────────────────────────────

  /**
   * Merge result: either clean merge or conflict state
   */
  async merge(
    repoId: string,
    theirBranch: string,
    author: { name: string; email: string },
  ): Promise<{ clean: true } | { clean: false; mergeState: MergeState }> {
    const dir = this.resolveRepoDir(repoId);
    const txId = randomId();

    const current =
      (await git.currentBranch({ fs, dir, fullname: false })) ?? "main";

    // Log MERGE_IN_PROGRESS for crash recovery
    await appendTx(dir, {
      id: txId,
      type: "merge",
      status: "PENDING",
      message: `MERGE_IN_PROGRESS: ${current} <- ${theirBranch}`,
      startedAt: Date.now(),
    });
    console.log(TAG, `merge PENDING (txId=${txId}) — merging ${theirBranch} into ${current}`);

    try {
      let oldOid = '0000000';
      try { oldOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}

      const result = await git.merge({
        fs,
        dir,
        ours: current,
        theirs: theirBranch,
        author,
        abortOnConflict: false,
      });

      // Fast-forward or auto-merge succeeded
      if (result.oid && !result.alreadyMerged) {
        await git.checkout({ fs, dir, ref: current });

        let newOid = '0000000';
        try { newOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}
        await appendReflogEntry(dir, {
          ref: 'HEAD',
          oldOid,
          newOid,
          action: 'merge',
          message: `merge ${theirBranch}: Fast-forward`,
          author: author.name,
        });

        await completeTx(dir, txId);
        await deleteGitCache(dir);
        console.log(TAG, `merge COMPLETED cleanly (txId=${txId})`);
        return { clean: true };
      }

      if (result.alreadyMerged) {
        await completeTx(dir, txId);
        console.log(TAG, `merge: already up-to-date (txId=${txId})`);
        return { clean: true };
      }

      return await this.handleMergeConflicts(dir, repoId, current, theirBranch, txId);
    } catch (err: any) {
      const isConflict =
        err?.code === 'MergeConflictError' ||
        err?.code === 'MergeNotSupportedError' ||
        (err?.message && err.message.includes('onflict'));
      const isUnmerged =
        err?.code === 'UnmergedPathsError' ||
        (err?.message && err.message.includes('nmerged'));

      if (isConflict) {
        console.log(TAG, `merge detected conflicts — entering resolution mode`);
        return await this.handleMergeConflicts(dir, repoId, current, theirBranch, txId);
      }

      if (isUnmerged) {
        // Leftover unmerged entries — force-checkout to clean, then retry
        console.warn(TAG, `merge hit UnmergedPathsError — cleaning up & retrying`);
        try {
          await git.checkout({ fs, dir, ref: current, force: true });
          try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_HEAD')); } catch {}
          try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_MSG')); } catch {}

          const retryResult = await git.merge({
            fs, dir, ours: current, theirs: theirBranch,
            author, abortOnConflict: false,
          });
          if (retryResult.oid && !retryResult.alreadyMerged) {
            await git.checkout({ fs, dir, ref: current });
            await completeTx(dir, txId);
            await deleteGitCache(dir);
            console.log(TAG, `merge COMPLETED cleanly after cleanup (txId=${txId})`);
            return { clean: true };
          }
          if (retryResult.alreadyMerged) {
            await completeTx(dir, txId);
            return { clean: true };
          }
          return await this.handleMergeConflicts(dir, repoId, current, theirBranch, txId);
        } catch (cleanupErr: any) {
          const isRetryConflict =
            cleanupErr?.code === 'MergeConflictError' ||
            cleanupErr?.code === 'MergeNotSupportedError' ||
            (cleanupErr?.message && cleanupErr.message.includes('onflict'));
          if (isRetryConflict) {
            return await this.handleMergeConflicts(dir, repoId, current, theirBranch, txId);
          }
          await failTx(dir, txId);
          console.error(TAG, `merge cleanup retry FAILED (txId=${txId})`, cleanupErr);
          throw cleanupErr;
        }
      }

      await failTx(dir, txId);
      console.error(TAG, `merge FAILED (txId=${txId})`, err);
      throw err;
    }
  }

  /**
   * Detect conflicted files and build the MergeState for the UI.
   */
  private async handleMergeConflicts(
    dir: string,
    repoId: string,
    oursBranch: string,
    theirsBranch: string,
    txId: string,
  ): Promise<{ clean: false; mergeState: MergeState }> {
    let statusMatrix: [string, number, number, number][] = [];
    try {
      statusMatrix = await git.statusMatrix({ fs, dir });
    } catch { /* fallback */ }

    const conflictedPaths: string[] = [];

    for (const [filepath, head, workdir, stage] of statusMatrix) {
      if (filepath.startsWith('.git/') || filepath === '.git') continue;
      if (stage === 3 || (workdir === 2 && head === 1)) {
        const fullPath = joinPath(dir, filepath);
        try {
          const content = (await fs.promises.readFile(fullPath, 'utf8')) as string;
          if (content.includes('<<<<<<<') && content.includes('>>>>>>>')) {
            conflictedPaths.push(filepath);
          }
        } catch { /* skip */ }
      }
    }

    if (conflictedPaths.length === 0) {
      for (const [filepath, , workdir] of statusMatrix) {
        if (filepath.startsWith('.git/')) continue;
        if (workdir === 2) {
          const fullPath = joinPath(dir, filepath);
          try {
            const content = (await fs.promises.readFile(fullPath, 'utf8')) as string;
            if (content.includes('<<<<<<<') && content.includes('>>>>>>>')) {
              conflictedPaths.push(filepath);
            }
          } catch { /* skip */ }
        }
      }
    }

    const conflicts: ConflictFile[] = [];
    for (const filepath of conflictedPaths) {
      const fullPath = joinPath(dir, filepath);
      const rawContent = (await fs.promises.readFile(fullPath, 'utf8')) as string;

      let oursContent = '';
      try {
        const oursOid = await git.resolveRef({ fs, dir, ref: oursBranch });
        const { blob } = await git.readBlob({ fs, dir, oid: oursOid, filepath });
        oursContent = new TextDecoder().decode(blob);
      } catch { oursContent = ''; }

      let theirsContent = '';
      try {
        const theirsOid = await git.resolveRef({ fs, dir, ref: theirsBranch });
        const { blob } = await git.readBlob({ fs, dir, oid: theirsOid, filepath });
        theirsContent = new TextDecoder().decode(blob);
      } catch { theirsContent = ''; }

      let baseContent = '';
      try {
        const oursOid = await git.resolveRef({ fs, dir, ref: oursBranch });
        const theirsOid = await git.resolveRef({ fs, dir, ref: theirsBranch });
        const [baseOid] = await git.findMergeBase({ fs, dir, oids: [oursOid, theirsOid] });
        if (baseOid) {
          const { blob } = await git.readBlob({ fs, dir, oid: baseOid, filepath });
          baseContent = new TextDecoder().decode(blob);
        }
      } catch { baseContent = ''; }

      const hunks = this.parseConflictHunks(rawContent);
      const fileName = filepath.split('/').pop() ?? filepath;

      conflicts.push({
        id: `conflict-${filepath}`,
        path: filepath,
        name: fileName,
        conflictCount: hunks.length,
        resolved: false,
        oursContent,
        theirsContent,
        baseContent,
        resultContent: '',
        oursBranch,
        theirsBranch,
        hunks,
      });
    }

    const mergeState: MergeState = {
      inProgress: true,
      repoId,
      oursBranch,
      theirsBranch,
      conflicts,
      txId,
    };

    console.log(TAG, `merge conflicts: ${conflicts.length} files, ${conflicts.reduce((s, c) => s + c.hunks.length, 0)} hunks`);
    return { clean: false, mergeState };
  }

  /**
   * Parse Git conflict markers from a file into structured hunks.
   */
  private parseConflictHunks(rawContent: string): ConflictHunk[] {
    const hunks: ConflictHunk[] = [];
    const lines = rawContent.split('\n');
    let i = 0;
    let hunkIndex = 0;

    while (i < lines.length) {
      if (lines[i].startsWith('<<<<<<<')) {
        const oursLines: string[] = [];
        const baseLines: string[] = [];
        const theirsLines: string[] = [];
        let phase: 'ours' | 'base' | 'theirs' = 'ours';
        i++;

        while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
          if (lines[i].startsWith('|||||||')) { phase = 'base'; i++; continue; }
          if (lines[i].startsWith('=======')) { phase = 'theirs'; i++; continue; }
          if (phase === 'ours') oursLines.push(lines[i]);
          else if (phase === 'base') baseLines.push(lines[i]);
          else theirsLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;

        hunks.push({
          id: `hunk-${hunkIndex++}`,
          oursContent: oursLines.join('\n'),
          baseContent: baseLines.join('\n'),
          theirsContent: theirsLines.join('\n'),
          resolved: false,
          resolution: null,
          resultContent: '',
        });
      } else {
        i++;
      }
    }
    return hunks;
  }

  /**
   * Clear unmerged (multi-stage) entries from the git index for given files.
   * isomorphic-git's git.add() does NOT remove stage 1/2/3 entries — we must
   * git.remove() first so the subsequent git.add() writes a clean stage-0.
   */
  private async clearUnmergedEntries(dir: string, filepaths: string[]): Promise<void> {
    for (const filepath of filepaths) {
      try {
        await git.remove({ fs, dir, filepath });
        console.log(TAG, `clearUnmergedEntries → removed index entries for ${filepath}`);
      } catch (rmErr) {
        console.warn(TAG, `clearUnmergedEntries → git.remove failed for ${filepath}`, rmErr);
      }
    }
  }

  /**
   * Stage a resolved conflict file.
   */
  async stageResolvedFile(repoId: string, filepath: string, resolvedContent: string): Promise<void> {
    const dir = this.resolveRepoDir(repoId);
    const fullPath = joinPath(dir, filepath);
    await fs.promises.writeFile(fullPath, resolvedContent, 'utf8');
    // Must remove first to clear any multi-stage (unmerged) index entries
    await this.clearUnmergedEntries(dir, [filepath]);
    await git.add({ fs, dir, filepath });
    console.log(TAG, `stageResolvedFile(${repoId}) → ${filepath}`);
  }

  /**
   * Finalize a merge after all conflicts are resolved.
   * Stages any remaining unmerged files before committing.
   */
  async finalizeMerge(
    repoId: string,
    theirBranch: string,
    author: { name: string; email: string },
    txId: string,
    resolvedFiles?: { path: string; hunks: ConflictHunk[] }[],
  ): Promise<void> {
    const dir = this.resolveRepoDir(repoId);
    const current =
      (await git.currentBranch({ fs, dir, fullname: false })) ?? "main";

    // ── 1. Capture merge parent oids BEFORE we touch the index ──
    const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    let theirOid: string | null = null;
    try {
      theirOid = await git.resolveRef({ fs, dir, ref: theirBranch });
    } catch {
      // Fallback: read .git/MERGE_HEAD written by git.merge({ abortOnConflict:false })
      try {
        const raw = (await fs.promises.readFile(
          joinPath(dir, '.git', 'MERGE_HEAD'), 'utf8'
        )) as string;
        theirOid = raw.trim();
      } catch { /* no MERGE_HEAD — single-parent commit */ }
    }
    console.log(TAG, `finalizeMerge → HEAD=${headOid.slice(0,8)}, theirs=${theirOid?.slice(0,8) ?? 'none'}`);

    // ── 2. Build resolved content for each conflicted file IN MEMORY ──
    const resolvedContents: { path: string; content: string }[] = [];
    if (resolvedFiles && resolvedFiles.length > 0) {
      for (const file of resolvedFiles) {
        const fullPath = joinPath(dir, file.path);
        try {
          const rawContent = (await fs.promises.readFile(fullPath, 'utf8')) as string;
          const content = this.buildResolvedContent(rawContent, file.hunks);
          resolvedContents.push({ path: file.path, content });
        } catch (err) {
          console.warn(TAG, `finalizeMerge → failed to read ${file.path}`, err);
        }
      }
    }

    // ── 3. Force-checkout to clear ALL unmerged (multi-stage) index entries ──
    //    isomorphic-git's git.add() does NOT remove stage 1/2/3 entries,
    //    so git.commit() always fails with UnmergedPathsError.
    //    A force-checkout resets the index & working-tree to HEAD.
    console.log(TAG, `finalizeMerge → force checkout "${current}" to clear unmerged index`);
    await git.checkout({ fs, dir, ref: current, force: true });

    // ── 4. Write resolved content back to disk (overwrites the clean checkout) ──
    for (const { path, content } of resolvedContents) {
      const fullPath = joinPath(dir, path);
      await fs.promises.writeFile(fullPath, content, 'utf8');
      console.log(TAG, `finalizeMerge → wrote resolved ${path} (${content.length} chars)`);
    }

    // ── 5. Stage every resolved file (index is now clean — no multi-stage) ──
    for (const { path } of resolvedContents) {
      await git.add({ fs, dir, filepath: path });
      console.log(TAG, `finalizeMerge → staged ${path}`);
    }

    // ── 6. Commit as a merge commit with both parents ──
    const message = `Merge branch '${theirBranch}' into ${current}`;
    const parents = theirOid ? [headOid, theirOid] : [headOid];
    await git.commit({
      fs, dir, message, author, committer: author,
      parent: parents,
    });

    // ── 7. Clean up leftover merge-state files ──
    try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_HEAD')); } catch {}
    try { await fs.promises.unlink(joinPath(dir, '.git', 'MERGE_MSG')); } catch {}

    await completeTx(dir, txId);
    await deleteGitCache(dir);
    console.log(TAG, `finalizeMerge COMPLETED — merged ${theirBranch} into ${current} (parents: ${parents.map(p => p.slice(0,8)).join(', ')})`);
  }

  /**
   * Abort an in-progress merge.
   */
  async abortMerge(repoId: string, txId: string): Promise<void> {
    const dir = this.resolveRepoDir(repoId);
    const current =
      (await git.currentBranch({ fs, dir, fullname: false })) ?? "main";
    await git.checkout({ fs, dir, ref: current, force: true });
    await failTx(dir, txId);
    await deleteGitCache(dir);
    console.log(TAG, `abortMerge — restored ${current}`);
  }

  /**
   * Read a file content from a specific branch ref.
   */
  async readFileAtRef(repoId: string, filepath: string, ref: string): Promise<string> {
    const dir = this.resolveRepoDir(repoId);
    try {
      const oid = await git.resolveRef({ fs, dir, ref });
      const { blob } = await git.readBlob({ fs, dir, oid, filepath });
      return new TextDecoder().decode(blob);
    } catch { return ''; }
  }

  async getPendingMerge(repoId: string): Promise<TransactionEntry | null> {
    const dir = this.resolveRepoDir(repoId);
    const txList = await readTransactions(dir);
    return txList.find(
      (e) => e.status === 'PENDING' && e.message?.startsWith('MERGE_IN_PROGRESS')
    ) ?? null;
  }

  async restoreMergeState(repoId: string): Promise<MergeState | null> {
    const dir = this.resolveRepoDir(repoId);
    const pending = await this.getPendingMerge(repoId);
    if (!pending || !pending.message) return null;

    const match = pending.message.match(/MERGE_IN_PROGRESS:\s*([^\s]+)\s*<-\s*([^\s]+)/);
    let ours = (await git.currentBranch({ fs, dir, fullname: false })) ?? "main";
    let theirs = "origin/main";
    if (match) {
      ours = match[1];
      theirs = match[2];
    } else {
      try {
        const mergeHead = await fs.promises.readFile(joinPath(dir, '.git', 'MERGE_HEAD'), 'utf8');
        theirs = String(mergeHead).trim();
      } catch {}
    }

    const { mergeState } = await this.handleMergeConflicts(dir, repoId, ours, theirs, pending.id);
    return mergeState;
  }

  /**
   * Rebuild a file from its content with conflict markers, applying resolutions.
   */
  buildResolvedContent(rawContent: string, hunks: ConflictHunk[]): string {
    // If no conflict markers in the file, return as-is
    if (!rawContent.includes('<<<<<<<') || !rawContent.includes('>>>>>>>')) {
      console.log(TAG, 'buildResolvedContent → no conflict markers found, returning as-is');
      return rawContent;
    }

    const lines = rawContent.split('\n');
    const result: string[] = [];
    let lineIdx = 0;
    let hunkIdx = 0;

    while (lineIdx < lines.length) {
      if (lines[lineIdx].startsWith('<<<<<<<') && hunkIdx < hunks.length) {
        const hunk = hunks[hunkIdx++];
        // Skip everything between <<<<<<< and >>>>>>>
        while (lineIdx < lines.length && !lines[lineIdx].startsWith('>>>>>>>')) {
          lineIdx++;
        }
        if (lineIdx < lines.length) lineIdx++; // skip the >>>>>>> line

        // Insert the resolved content (may be multi-line)
        if (hunk.resultContent) {
          result.push(hunk.resultContent);
        }
      } else {
        result.push(lines[lineIdx]);
        lineIdx++;
      }
    }

    const output = result.join('\n');

    // Safety check: verify no conflict markers remain
    if (output.includes('<<<<<<<') || output.includes('>>>>>>>')) {
      console.warn(TAG, 'buildResolvedContent → WARNING: conflict markers still present after resolution!');
      console.warn(TAG, `  hunks provided: ${hunks.length}, hunks consumed: ${hunkIdx}`);
    } else {
      console.log(TAG, `buildResolvedContent → clean output (${output.length} chars, ${hunkIdx} hunks resolved)`);
    }

    return output;
  }


  // â”€â”€ Recovery: find PENDING transactions across all repos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getPendingTransactions(): Promise<
    { repoId: string; dir: string; entries: TransactionEntry[] }[]
  > {
    await this.init();
    const results: {
      repoId: string;
      dir: string;
      entries: TransactionEntry[];
    }[] = [];
    const entries = await fs.promises.readdir(BASE_DIR);

    for (const name of entries) {
      const dir = this.resolveRepoDir(name);
      const hasGit = await fs.promises
        .stat(joinPath(dir, ".git"))
        .catch(() => null);
      if (!hasGit) continue;

      const txList = await readTransactions(dir);
      const pending = txList.filter((e) => e.status === "PENDING");
      if (pending.length > 0) {
        // Auto-expire PENDING transactions older than 5 minutes
        const STALE_MS = 5 * 60 * 1000;
        const now = Date.now();
        let hasStale = false;
        for (const p of pending) {
          if (now - p.startedAt > STALE_MS) {
            hasStale = true;
            break;
          }
        }
        if (hasStale) {
          const updated = txList.map((e) =>
            e.status === "PENDING" && now - e.startedAt > STALE_MS
              ? { ...e, status: "FAILED" as const, completedAt: now }
              : e,
          );
          await writeTransactions(dir, updated);
          const remaining = updated.filter((e) => e.status === "PENDING");
          if (remaining.length > 0) {
            console.warn(
              TAG,
              `\u26A0 PENDING transactions in ${name}:`,
              remaining.map((p) => `${p.type}(${p.id})`).join(", "),
            );
            results.push({ repoId: name, dir, entries: remaining });
          } else {
            console.log(TAG, `Auto-expired stale transactions in ${name}`);
          }
        } else {
          console.warn(
            TAG,
            `\u26A0 PENDING transactions in ${name}:`,
            pending.map((p) => `${p.type}(${p.id})`).join(", "),
          );
          results.push({ repoId: name, dir, entries: pending });
        }
      }
    }

    return results;
  }
}

export const gitEngine = new GitEngine();
