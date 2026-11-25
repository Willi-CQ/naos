import '@fontsource/b612/latin-400.css';
import '@fontsource/b612/latin-700.css';
import '@fontsource-variable/martian-mono/wdth.css';
import '@fontsource/cormorant/latin-300.css';
import '@fontsource/cormorant/latin-300-italic.css';
import '@fontsource/eb-garamond/greek-500-italic.css';
import './styles/index.css';
import './styles/project.css';
import './styles/workspace.css';
import './styles/surface.css';
import './styles/chat.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installKeys } from './hud/keymap.ts';
import { registerCoreOverlays } from './hud/overlays.tsx';
import { registerHand } from './hud/sheets/hand.tsx';
import { attend, startKernelLink, useNaos } from './store/store.ts';

// For shots and the headless tooling. Nothing in the page reads it.
(window as unknown as { __naos: typeof useNaos }).__naos = useNaos;

registerCoreOverlays();
installKeys();
registerHand();
startKernelLink();

// A Windows notification opens `/#docket=<requestId>` (DESIGN 3.7). The decision may not have arrived yet, so wait for it.
const wanted = /^#docket=(.+)$/.exec(location.hash)?.[1];
if (wanted) {
  const stop = useNaos.subscribe((s) => s.model.decisions, (decisions) => {
    if (decisions.some((d) => d.requestId === wanted)) {
      stop();
      attend(wanted);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
