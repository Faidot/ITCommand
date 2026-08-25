import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

// Application entry point. Providers are nested so that:
//  - ThemeProvider toggles the `dark` class on <html> (outermost, affects everything)
//  - ToastProvider exposes useToast() to all children (incl. AuthContext side effects)
//  - AuthProvider restores the session and exposes user/app config
//  - BrowserRouter enables react-router routes
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
