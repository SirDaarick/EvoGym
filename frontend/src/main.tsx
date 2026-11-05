import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './app/queryClient';
import { RootApp } from './app/RootApp';
import './styles.css';
import { initPwa } from './offline/pwaLifecycle';

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><QueryClientProvider client={queryClient}><RootApp /></QueryClientProvider></BrowserRouter></StrictMode>);

void initPwa();
