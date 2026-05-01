import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isAuthenticated } from './lib/auth.js'
import Sidebar from './components/Sidebar.jsx'

const Login = lazy(() => import('./pages/Login.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Konkurrenten = lazy(() => import('./pages/Konkurrenten.jsx'))
const Wissensdatenbank = lazy(() => import('./pages/Wissensdatenbank.jsx'))
const ContentGenerator = lazy(() => import('./pages/ContentGenerator.jsx'))
const ReelImport = lazy(() => import('./pages/ReelImport.jsx'))
const Brain = lazy(() => import('./pages/Brain.jsx'))

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100dvh', background: '#080808'
    }}>
      <div className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  )
}

function ProtectedRoute({ children }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />
  return children
}

function AppLayout({ children }) {
  const location = useLocation()
  const isLogin = location.pathname === '/login'

  if (isLogin) {
    return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Suspense fallback={<LoadingScreen />}>{children}</Suspense>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/konkurrenten" element={<ProtectedRoute><Konkurrenten /></ProtectedRoute>} />
          <Route path="/wissensdatenbank" element={<ProtectedRoute><Wissensdatenbank /></ProtectedRoute>} />
          <Route path="/generator" element={<ProtectedRoute><ContentGenerator /></ProtectedRoute>} />
          <Route path="/import" element={<ProtectedRoute><ReelImport /></ProtectedRoute>} />
          <Route path="/brain" element={<ProtectedRoute><Brain /></ProtectedRoute>} />
<Route path="*" element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}
