import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { MobileApp } from './mobile/MobileApp';
import { Live2DDemo } from './mobile/Live2DDemo';
import { DesktopPresence } from './components/Presence/DesktopPresence';
import './index.css';

const query = new URLSearchParams(window.location.search);
const useDesktopPresence = query.has('presence');
const useLive2DDemo = query.has('live2d');
const useMobileShell = Capacitor.isNativePlatform() || query.has('mobile');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {useDesktopPresence
      ? <DesktopPresence />
      : useLive2DDemo
        ? <Live2DDemo />
        : useMobileShell
          ? <MobileApp />
          : <App />}
  </React.StrictMode>
);
