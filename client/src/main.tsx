import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles/base.css';
import './styles/app-shell.css';
import './styles/login-page.css';
import './styles/products-page.css';
import './styles/pickup-list-page.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root was not found.');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
