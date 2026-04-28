# Task List - Project Hail Rocky Frontend Refactor

## Phase 1: Quick Wins (Foundation) ✅
- [x] **Setup Zustand**: Created `src/store/useRockyStore.ts` with FSM logic.
- [x] **Centralized Sockets**: Implemented `src/hooks/useRockySockets.ts` to manage all listeners.
- [x] **App Cleanup**: Removed prop-drilling and redundant state from `App.tsx`.
- [x] **Store Integration**: Refactored `MusicMode`, `CinemaMode`, and `SunsetMode` to use the store.

## Phase 2: Structural Refactor & Fluid UI ("Wow" Factor) 🏗️
- [x] **Organic Visualizer**: Hybrid rendering with Framer Motion (mood) + Canvas (audio data) + SVG Gooey Filter.
- [x] **Widget System**: Extracted rich content logic from `Chat.tsx` to `src/components/widgets/RichCard.tsx`.
- [x] **Neural Center**: Merged `ScenesMode` and `ProtocolsMode` into a unified command center.
- [x] **Design Refinement**: Upgraded `premium-glass` and glassmorphism utilities in `index.css`.
- [x] **Type Safety**: Verified all frontend files with `tsc`.

## Next Steps 🚀
- [ ] **Mobile Optimization**: Fine-tune the Neural Center for touch interfaces.
- [ ] **Advanced Animations**: Add micro-interactions for protocol deployment.
- [ ] **Performance Audit**: Profile the Gooey Visualizer on lower-end devices.
