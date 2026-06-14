# GitLane Features Checklist

- [x] 1. Branch Operations (Backend & Frontend)
  - [x] Implement backend `deleteBranch` in `GitEngine`
  - [x] Implement backend `renameBranch` in `GitEngine`
  - [x] Add Frontend branch delete/rename options to branch dropdown in `app/repository/[id].tsx`
- [x] 2. Merge Conflict Resolution Screen Wiring
  - [x] Replace `mockConflicts` usage in `contexts/GitContext.tsx`
  - [x] Handle `gitEngine.pull` and `gitEngine.push` returns inside context to redirect to conflict view
  - [x] Implement staging/saving real conflicts in `app/merge-conflicts.tsx`
- [x] 3. Real Commit Graph Layout
  - [x] Replace simple columns with topological node column mapping in `app/(tabs)/graph/index.tsx`
  - [x] Draw parent connections dynamically using SVG lines
- [x] 4. P2P File Transfer & WebSocket Pairing
  - [x] Transfer screen fully wired to `p2pService.ts` (file share + relay send/receive)
- [x] 5. TypeScript — zero errors (`npx tsc --noEmit` passes clean)

## Ready to build APK
See `FINAL_STEPS.md` for exact commands.
