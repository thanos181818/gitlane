# GitLane — Problem, Root Cause, Backend/Frontend Status, Solution (PRBS.md)
> *Documenting all issues, partial implementations, and UI-only features without changing any code*

---

## Table of Contents
1. [P0 Critical Issues (Must-Fix)](#1-p0-critical-issues-must-fix)
2. [P1 High Priority Issues](#2-p1-high-priority-issues)
3. [P2 Medium Priority / UI-Only Issues](#3-p2-medium-priority--ui-only-issues)
4. [Environment & Build Issues](#4-environment--build-issues)

---

## 1. P0 Critical Issues (Must-Fix)

### 1.1 Merge Conflict Resolution UI is Mocked — Doesn’t Actually Resolve Conflicts
- **Problem**: The merge-conflicts screen (`merge-conflicts.tsx`) renders hardcoded mock data from `mocks/repositories.ts`. Resolving conflicts only updates local state, never writes to the filesystem or creates a merge commit.
- **Root Cause**: `GitContext.tsx` initializes `conflicts` with `mockConflicts`, and `resolveConflictHunk`/`finalizeMerge` don’t call `git.add` or `git.commit`.
- **Backend Status**: ❌ No (conflict parsing exists but isn’t wired to UI)
- **Frontend Status**: ✅ Fully designed UI
- **Solution**: 
  1. Source real conflict data from `git.statusMatrix()` looking for stage === 3.
  2. Wire `resolveConflictHunk` to build the resolved file content.
  3. Make `finalizeMerge` write the resolved content, stage it, and commit with dual parents.

---

## 2. P1 High Priority Issues

### 2.2 `isomorphic-git.merge()` has `ours: undefined as any`
- **Problem**: In `engine.ts` line ~563, `git.merge()` receives `ours: undefined as any`.
- **Root Cause**: TypeScript cast to avoid errors, but isomorphic-git expects a valid branch ref.
- **Backend Status**: ⚠️ Fragile
- **Frontend Status**: ✅ N/A
- **Solution**: Get current branch first:
  ```typescript
  const ours = await git.currentBranch({ fs, dir }) ?? 'main';
  await git.merge({ fs, dir, ours, theirs: theirBranch, author });
  ```

---

### 2.3 Commit Graph Shows Mock/Zero Data for Stats & Branches
- **Problem**: `getCommits()` in `engine.ts` returns `branches: []`, `filesChanged: 0`, `additions: 0`, `deletions: 0` for all commits.
- **Root Cause**: No logic to calculate these stats or map branches to commits.
- **Backend Status**: ❌ Stats not implemented
- **Frontend Status**: ✅ Graph UI works
- **Solution**:
  1. Use `git.listBranches()` and map OIDs to branch names.
  2. Use `git.walk()` or `git.diff()` to calculate filesChanged/additions/deletions per commit.

---

### 2.4 "Import Existing" in Add Repo Does Nothing
- **Problem**: In `add-repo.tsx`, tapping the "Import Existing" card only triggers haptic feedback — no import flow.
- **Root Cause**: No `onPress` logic or navigation wired.
- **Backend Status**: ✅ `gitEngine.cloneRepo()` exists
- **Frontend Status**: ❌ No import flow UI
- **Solution**:
  1. Add a file picker using `expo-document-picker`.
  2. Or, add a URL input to clone from remote (using existing `cloneRepo`).

---

### 2.5 "Create New Branch" Button Has No Handler
- **Problem**: In `repository/[id].tsx`, the "+ Create new branch" button has no `onPress`.
- **Root Cause**: Missing button handler.
- **Backend Status**: ✅ `createBranch()` exists
- **Frontend Status**: ❌ No input modal
- **Solution**: Add a text input modal and call `createBranch(repo.id, branchName)`.

---

## 3. P2 Medium Priority / UI-Only Issues

### 3.1 P2P Transfer Screen is Pure UI Mockup
- **Problem**: The transfer screen (`transfer/index.tsx`) has:
  - Auto-transitioning state after delays
  - Hardcoded progress values ("45 MB / 120 MB")
  - No real WebSocket or file sharing logic
- **Root Cause**: The TODO list marked this as a stretch goal and only implemented UI.
- **Backend Status**: ❌ No (p2pService.ts exists but isn't fully wired)
- **Frontend Status**: ✅ Fully designed UI
- **Solution**: Wire UI to `p2pService.ts` functions (`startSenderSession`, `joinReceiverSession`).

---

### 3.2 Several Settings Features are Stubbed (No Logic)
- **Problem**: In Settings screen (`settings/index.tsx`):
  - "Repository Health" → only shows a toast
  - "Export All" → only shows a toast
- **Root Cause**: TODO list marked these as stretch goals.
- **Backend Status**: ❌ No implementation
- **Frontend Status**: 🟡 Stub UI only

---

### 3.3 Terminal Screen is Stubbed
- **Problem**: `terminal/index.tsx` is a placeholder — no actual command execution.
- **Root Cause**: Low priority item.
- **Backend Status**: ❌ No
- **Frontend Status**: 🟡 Stub only

---

### 3.4 Chatbot Screen is Stubbed (Mock AI Responses)
- **Problem**: `chatbot.tsx` uses `FAKE_RESPONSES` array to generate random messages.
- **Root Cause**: TODO list marked AI as P2/online-only.
- **Backend Status**: ❌ No real AI integration
- **Frontend Status**: ✅ Fully designed chat UI


### 4.3 Environment Variables for PieSocket
- **Problem**: `EXPO_PUBLIC_PIESOCKET_KEY` needs to be set manually.
- **Root Cause**: The variable isn't committed to the repo (good practice!).
- **Solution**: Document it in README or use EAS Secrets for production builds.

---

## Summary Table of Features
| Feature | Backend | Frontend | Status |
|---------|---------|----------|--------|
| Branch Create | ✅ | ❌ | Needs UI handler |
| Branch Delete/Rename | ❌ | ❌ | Not Implemented |
| Merge Conflict Resolution | ❌ | ✅ | Needs wiring |
| Commit Graph | ✅ | ✅ | Stats are mock |
| P2P Transfer | ⚠️ | ✅ | Needs wiring |
| Settings | ✅ | ✅ | Some stubs |

