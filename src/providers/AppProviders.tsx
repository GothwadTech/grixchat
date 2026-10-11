import React from 'react';
import { ThemeProvider } from '../contexts/ThemeContext';
import { SearchProvider } from '../contexts/SearchContext';
import { AuthProvider } from './AuthProvider';
import { PresenceProvider } from './PresenceProvider';
import { CallProvider } from './CallProvider';

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <ThemeProvider>
      <SearchProvider>
        <AuthProvider>
          <PresenceProvider>
            <CallProvider>
              {children}
            </CallProvider>
          </PresenceProvider>
        </AuthProvider>
      </SearchProvider>
    </ThemeProvider>
  );
};
