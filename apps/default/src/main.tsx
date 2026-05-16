import './index.css';
import './lib/leaflet-setup';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.jsx';
import { GenesisRoot } from './lib/genesis.jsx';
import { setupThemeBridge } from './lib/theme-bridge';

setupThemeBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GenesisRoot>
      <App />
    </GenesisRoot>
  </StrictMode>,
);
