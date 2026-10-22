import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { MobileApp } from './mobile/MobileApp';
import { Live2DDemo } from './mobile/Live2DDemo';
import './index.css';

const query = new URLSearchParams(window.location.search);
const useLive2DDemo = query.has('live2d');
const useMobileShell = Capacitor.isNativePlatform() || query.has('mobile');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {useLive2DDemo ? <Live2DDemo /> : useMobileShell ? <MobileApp /> : <App />}
  </React.StrictMode>
);
