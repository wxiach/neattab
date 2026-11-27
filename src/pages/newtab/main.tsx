import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { NewtabApp } from './NewtabApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NewtabApp />
  </StrictMode>,
);
