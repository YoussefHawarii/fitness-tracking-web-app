import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AccountProvider } from './context/AccountContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { Signup } from './pages/Signup';
import { VerifyOtp } from './pages/VerifyOtp';
import { Login } from './pages/Login';
import { Onboarding } from './pages/Onboarding';
import { Goals } from './pages/Goals';
import { Account } from './pages/Account';
import { Dashboard } from './pages/Dashboard';
import { FoodLog } from './pages/FoodLog';
import { WeightTrend } from './pages/WeightTrend';
import { Exercise } from './pages/Exercise';
import { Terms } from './pages/legal/Terms';
import { Privacy } from './pages/legal/Privacy';
import { Help } from './pages/legal/Help';

function AppPage({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <AccountProvider>
        <AppShell>{children}</AppShell>
      </AccountProvider>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/legal/terms" element={<Terms />} />
            <Route path="/legal/privacy" element={<Privacy />} />
            <Route path="/legal/help" element={<Help />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/verify-otp" element={<VerifyOtp />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <Onboarding />
                </ProtectedRoute>
              }
            />
            <Route
              path="/goals"
              element={
                <AppPage>
                  <Goals />
                </AppPage>
              }
            />
            <Route
              path="/account"
              element={
                <AppPage>
                  <Account />
                </AppPage>
              }
            />
            <Route
              path="/dashboard"
              element={
                <AppPage>
                  <Dashboard />
                </AppPage>
              }
            />
            <Route
              path="/food-log"
              element={
                <AppPage>
                  <FoodLog />
                </AppPage>
              }
            />
            <Route
              path="/weight-trend"
              element={
                <AppPage>
                  <WeightTrend />
                </AppPage>
              }
            />
            <Route
              path="/exercise"
              element={
                <AppPage>
                  <Exercise />
                </AppPage>
              }
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
