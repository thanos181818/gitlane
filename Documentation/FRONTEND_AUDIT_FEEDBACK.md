# GitLane Frontend Audit — TODO.md vs Actual Implementation

> Audit performed on 2026-02-21 against `Frontend/` codebase

---

## ✅ Items Marked Done — Verified Correct

### Repository Core [P0]

| TODO Item | Verdict | Evidence |
|---|---|---|
| `[x]` Full offline Git backend (init, clone, commit, checkout, branch, tag, log, status) using isomorphic-git | ✅ **Done** | `engine.ts` implements `createRepository`, `cloneRepo`, `commit`, `switchBranch`, `createBranch`, `merge`, `getCommits`, `getWorkingTree` — all backed by `isomorphic-git` |
| `[x]` Repo storage compatible with desktop Git (objects, refs, config) in File System | ✅ **Done** | `expo-fs.ts` maps POSIX paths to `Paths.document` URIs; `.git/` directory structure is standard |
| `[x]` Atomic storage operations with crash recovery / transaction logs in `.git` | ✅ **Done** | `engine.ts` has `appendTx`, `completeTx`, `failTx` writing to `.git/gitlane_transactions.json`; `RecoveryAlert.tsx` detects PENDING transactions on launch |

### Mobile UX [P1]

| TODO Item | Verdict | Evidence |
|---|---|---|
| `[x]` Touch-optimized staging workflow (file selection, hunks, staged vs unstaged) | ✅ **Done** | `repository/[id].tsx` has Changes tab with `ChangeFileRow`, checkbox toggle for stage/unstage (`stageFile`/`unstageFile` via `git.add`/`git.resetIndex`), commit composer |

### Data Hierarchy & Caching

| TODO Item | Verdict | Evidence |
|---|---|---|
| `[x]` Git data hierarchy via `.git` folder with desktop compatibility | ✅ **Done** | All data lives in `.git/` on the native FS via `expo-fs.ts` |
| `[x]` Git-aligned file system caching (AsyncStorage for settings, `.git/gitlane_cache.json` for commits/graph) | ✅ **Done** | `storage.ts` uses `AsyncStorage` for settings + `gitlane_cache.json` in `.git/` for cache. `GitContext.tsx` reads/writes cache via `storage.readCache`/`writeCache` |
| `[x]` Transaction logs in `.git` for crash-safe recovery | ✅ **Done** | Same as atomic ops above. `RecoveryAlert.tsx` scans on mount |
| `[x]` Commit log caching in `.git` with invalidation on new commits/merges | ✅ **Done** | `GitContext.tsx` → `commitsQuery` reads from cache first; `storage.deleteCache` called after commit/merge in both `GitContext` and `engine.ts` |

### Additional Reliability

| TODO Item | Verdict | Evidence |
|---|---|---|
| `[x]` Native dependency cleanup (Expo Go-safe: AsyncStorage + File System) | ✅ **Done** | `package.json` uses `expo-file-system`, `@react-native-async-storage/async-storage`. No LightningFS, no IndexedDB |
| `[x]` Crash-safe storage with transaction logs and recovery prompts | ✅ **Done** | `RecoveryAlert.tsx` shows banner with "Interrupted Operations Detected" |

### Demo Prep

| TODO Item | Verdict | Evidence |
|---|---|---|
| `[x]` Seeding Data: demo repo ready to import instantly | ✅ **Done** | `engine.ts` → `ensureDemoRepo()` auto-seeds `GitLane-Demo` with files/commits on bootstrap |
| `[x]` Pre-Seed Conflict: demo repo has guaranteed merge conflict | ✅ **Done** | `ensureDemoRepo()` creates `feature-conflict` branch with conflicting `readme.md` content |

---

## ⚠️ Issues Found — Marked Done but Incomplete or Has Problems

### 1. Merge Conflicts UI uses **hardcoded mock data**, not real Git conflicts

> **TODO Line 29:** `[x] Design touch-optimized staging workflow`  
> (Staging is fine, but the merge conflict resolution is wired to mocks)

- **Problem:** `GitContext.tsx` line 33 initialises conflicts with `mockConflicts` imported from `mocks/repositories.ts`. The merge-conflicts screen (`merge-conflicts.tsx`) renders from this hardcoded array. `resolveConflict()` only sets local state — it **never writes** the resolved content back to the file system or calls `git.add` / `git.commit`.
- **Impact:** The conflict resolution UI looks great (Ours vs Theirs cards, progress bar) but does **not** actually resolve a real conflict in the repo. The "Complete Merge" button just calls `showToast` and `router.back()`.
- **Recommendation:** Wire `resolveConflict` to write the chosen content to the conflicted file via `expoFS`, then `git.add` + `git.commit` with a merge commit message. Source conflict data from `statusMatrix` (stage === 3) instead of mock data.

### 2. `merge()` in `engine.ts` passes `ours: undefined as any`

- **File:** `engine.ts` line 563
  ```ts
  await git.merge({ fs, dir, ours: undefined as any, theirs: theirBranch, author });
  ```
- **Problem:** `ours` is cast as `any` to suppress TypeScript. `isomorphic-git.merge()` expects `ours` to be the current branch ref. Passing `undefined` may work if isomorphic-git defaults to HEAD, but this is fragile and may behave unexpectedly.
- **Recommendation:** Set `ours` to the current branch name:
  ```ts
  const ours = await git.currentBranch({ fs, dir }) ?? 'main';
  ```

### 3. Commit graph uses **mock data** for `branches`, `filesChanged`, `additions`, `deletions`

- **Problem:** `engine.ts` → `getCommits()` returns `branches: []`, `filesChanged: 0`, `additions: 0`, `deletions: 0` for every commit. The graph screen (`graph/index.tsx`) displays these zeros in the tooltip ("0 files · +0 −0").
- **Impact:** The commit graph SVG visualization is functional but tooltips and stat labels are empty/zeroed. Branch tags never appear on commit nodes (since `branches` is always `[]`).
- **Recommendation:** Compute `branches` by cross-referencing `git.listBranches` with commit OIDs. For `filesChanged`/`additions`/`deletions`, diff each commit against its parent via `git.walk`.

### 4. Transfer screen is **UI-only** — no actual P2P logic

- **File:** `transfer/index.tsx`
- **Problem:** The Send/Receive UI is fully designed but:
  - "Start Transfer" just sets state to `'waiting'` then auto-transitions to `'connected'` after a 3s timeout
  - `TransferProgress` shows hardcoded "45 MB / 120 MB • 2.5 MB/s"
  - "Simulate Receive" does nothing except haptic feedback
  - No real `.bundle` creation, no `expo-sharing`, no `react-native-tcp-socket`
- **Impact:** This screen is a pure UI mockup. The TODO for P2P transfer is `[ ]` (not marked done), so this is **expected** — just noting it for reference.

### 5. "Import Existing" repository does **nothing**

- **File:** `add-repo.tsx` line 42-56
- **Problem:** The "Import Existing" card's `onPress` only triggers haptic feedback and does not navigate anywhere or perform a file-system import. No clone-from-URL flow either (despite `GitEngine.cloneRepo` existing).
- **Recommendation:** Allow importing from device storage using `expo-document-picker` or wire the action to the clone flow for URL-based importing.

### 6. "Create new branch" in repository detail does **nothing**

- **File:** `repository/[id].tsx` line 240-243
- **Problem:** The "+ Create new branch" button in the branch dropdown doesn't call `createBranch()` — it has no `onPress` handler that triggers the actual branch creation.
- **Recommendation:** Add a text input modal and call `createBranch(repo.id, branchName)`.

---

## 📋 Summary of TODO `[x]` Items

| # | TODO Item | Status |
|---|---|---|
| 1 | Offline Git backend (init/clone/commit/checkout/branch/log/status) | ✅ Fully implemented |
| 2 | Repo storage compatible with desktop Git | ✅ Fully implemented |
| 3 | Atomic storage + crash recovery / transaction logs | ✅ Fully implemented |
| 4 | Touch-optimized staging workflow | ✅ Implemented (stage/unstage/commit works) |
| 5 | Git data hierarchy via `.git` with desktop compat | ✅ Fully implemented |
| 6 | Git-aligned FS caching | ✅ Fully implemented |
| 7 | Transaction logs in `.git` | ✅ Fully implemented |
| 8 | Commit log caching with invalidation | ✅ Fully implemented |
| 9 | Native dependency cleanup (Expo Go-safe) | ✅ Fully implemented |
| 10 | Crash-safe storage with recovery prompts | ✅ Fully implemented |
| 11 | Seeding data (demo repo) | ✅ Fully implemented |
| 12 | Pre-seed conflict | ✅ Fully implemented |

---

## 🔍 Missing UI / Not Yet Implemented (TODO `[ ]` items with partial UI)

| Feature | UI Exists? | Backend Exists? | Notes |
|---|---|---|---|
| File diffs with syntax highlighting | ❌ No | ❌ No | `file-viewer.tsx` shows raw text, no diff/syntax highlighting |
| Fast file search | ❌ No | ❌ No | No search bar in file browser |
| Code reader mode with variable fonts | ❌ No | ❌ No | — |
| Repository health dashboard | 🟡 Stub only | ❌ No | Settings has "Repository Health" row that just shows a toast |
| Interactive rebase | ❌ No | ❌ No | Stretch goal |
| Stash management | ❌ No | ❌ No | Stretch goal |
| Branching operations (delete, rename) | ❌ No | ❌ No | Only create + switch exist |
| Commit graph divergence heatmaps | 🟡 Basic graph | ❌ No | Graph exists but is simple columns-based, no heatmap |
| AI command agent | ❌ No | ❌ No | P2 - Online only |
| P2P transfer | 🟡 UI only | ❌ No | Pure mockup |

---

## 🛠 Expo Compatibility Notes

- **No native module issues detected.** All dependencies (`isomorphic-git`, `expo-file-system`, `AsyncStorage`, `react-native-svg`, `lucide-react-native`) are Expo-compatible.
- `expo-file-system` v19 uses the new `File`/`Directory` API from Expo SDK 54 — the `expo-fs.ts` adapter correctly uses these classes.
- `react-native-mmkv` (mentioned in GITLANE_LOGIC_BLUEPRINT) is **NOT** used. The app uses `AsyncStorage` + `.git/` file-based storage instead. This is fine for Expo Go compatibility but may be slower for high-frequency reads. Consider switching to `expo-secure-store` or MMKV if performance becomes an issue.
- `expo-haptics` calls are correctly guarded with `Platform.OS !== 'web'` checks throughout.
