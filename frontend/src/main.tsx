import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { RootApp } from './app/RootApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><RootApp /></BrowserRouter></StrictMode>);
