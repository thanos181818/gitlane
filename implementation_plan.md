# GitLane Feature Implementation Plan

We need to implement the following changes across Backend (GitEngine) and Frontend (React Native UI).

---

## Proposed Changes

### 1. Branch Operations (Backend & Frontend)
- **Backend (`GitEngine`):**
  - Implement `deleteBranch(repoId, branchName)` using `isomorphic-git`'s `deleteRef` API.
  - Implement `renameBranch(repoId, oldName, newName)` by creating a ref at `newName` matching the commit SHA of `oldName`, and then deleting `oldName`.
- **Frontend (`app/repository/[id].tsx`):**
  - Add option buttons/menus beside branch list items inside the Branch Selector dropdown to call delete/rename.
  - Trigger warning modals before deleting a branch.

### 2. Merge Conflict Resolution Screen Wiring
- **Frontend (`contexts/GitContext.tsx` & `app/merge-conflicts.tsx`):**
  - Replace `mockConflicts` from `mock/repositories` with the real state tracked inside the context.
  - When `gitEngine.pull` or `gitEngine.push` returns `{ clean: false, mergeState }`, correctly set the `mergeState` and list of `conflicts` in `GitContext`.
  - Ensure `stageResolvedConflictFile` resolves hunks from the UI state, writes the merged file back to disk using `GitEngine.stageResolvedFile`, and updates the UI status.

### 3. Real Commit Graph Layout
- **Frontend (`app/(tabs)/graph/index.tsx`):**
  - Replace the linear-by-branch columns with a topological sorting algorithm.
  - Traverse commits using parent arrays `commit.parents` to build a multi-column visual matrix.
  - Draw SVG branch paths connecting parents to children (merges represented as branching and merging paths).

### 4. P2P File Transfer & WebSocket Pairing
- **Frontend (`app/(tabs)/transfer/index.tsx`):**
  - Remove empty placeholders. Connect the WebSocket pairing mechanism to `startSenderSession` and `joinReceiverSession` defined in `p2pService.ts`.
  - When a session matches, send the `.gitlanepatch` file bundle (which wraps isomorphic-git diff formats) over WebSockets using the PieSocket API.

### 5. Settings Config Integration
- **Frontend (`app/(tabs)/settings/index.tsx` & `GitContext.tsx`):**
  - Bind settings controls (user name, email, accent color) so edits persist using the storage service.
  - Update `GitEngine` commits and operations to read identity variables (`settings.userConfig`) rather than falling back to defaults.

---

## Verification Plan

### Manual Verification
- **Branch Management:** Create, switch, rename, and delete branches on a test repository.
- **Merge Conflicts:** Deliberately trigger a merge conflict (e.g. pull from a branch with edited lines on the same file) and resolve using the 3-Way conflicts tool.
- **Commit Graph:** Commit multiple changes across branched histories and check if the SVG graph draws non-linear histories correctly.
- **P2P Transfer:** Pair two clients (or simulator/phone) and perform a direct diff file sync.
- **Settings:** Edit user name or email in Settings, run a commit, and inspect if the author fields update.
