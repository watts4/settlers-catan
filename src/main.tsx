import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './ui/App';

if (/netlify\.app$/.test(window.location.hostname)) document.documentElement.classList.add('on-netlify');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
