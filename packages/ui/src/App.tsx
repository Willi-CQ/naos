import { MotionConfig } from 'motion/react';
import { AppShell } from './hud/AppShell.tsx';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AppShell />
    </MotionConfig>
  );
}
