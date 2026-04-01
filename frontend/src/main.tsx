import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { AppQueryProvider } from './providers/query-provider';
import { ThemeProvider } from './hooks/use-theme';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppQueryProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AppQueryProvider>
  </React.StrictMode>,
);
