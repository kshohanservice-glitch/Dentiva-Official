import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/inter';
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-bengali/500.css';
import '@fontsource/noto-sans-bengali/600.css';
import '@fontsource/noto-sans-bengali/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/print.css';

import { App } from './app/App';
import { AppProvider } from './app/state';
import { ConfirmProvider, ToastProvider } from './components/ui';

const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
