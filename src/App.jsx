import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isAuthenticated } from './lib/auth.js'
import BottomNav from './components/BottomNav.jsx'

const Login = lazy(() => import('./pages/Login.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Konkurrenten = lazy(() => import('./pages/Konkurrenten.jsx'))
const Wissensdatenbank = lazy(() => import('./pages/Wissensdatenbank.jsx'))
const ContentGenerator = lazy(() => import('./pages/ContentGenerator.jsx'))
const ReelImport = lazy(() => import('./pages/ReelImport.jsx'))

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100dvh', background: '#0a0a0a'
    }}>
      <div className="spinner" style={{ width: 28, height: 28 }} />
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
  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        {children}
      </Suspense>
      {!isLogin && <BottomNav />}
    </>
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
          <Route path="*" element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}
