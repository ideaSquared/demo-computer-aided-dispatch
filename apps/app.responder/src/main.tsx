import { darkTheme } from '@cad/lib.ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/global.css.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

// Apply the active theme as a class on the root. Swap to `lightTheme` or
// `normalTheme` to change palette; vars resolve automatically.
document.documentElement.classList.add(darkTheme);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
