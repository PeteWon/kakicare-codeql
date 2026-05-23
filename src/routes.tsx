// Central route definitions for KakiCare.
//
// Three areas, each with its own layout:
//   - public    : shared pages (landing, login, register, verify email)
//   - volunteer : volunteer-facing area (mobile-first)
//   - staff     : staff-facing management area
//
// NOTE: route grouping here is structural only. Real access control (ensuring a
// volunteer cannot reach staff routes, etc.) must be enforced by the BACKEND on
// every request, and will be layered in with guards later. Hiding routes on the
// client is not a security boundary.

import { createBrowserRouter } from 'react-router-dom';

import { ProtectedRoute } from './components/ProtectedRoute';
import { PublicLayout } from './layouts/PublicLayout';
import { VolunteerLayout } from './layouts/VolunteerLayout';
import { StaffLayout } from './layouts/StaffLayout';

import { Landing } from './pages/public/Landing';
import { Login } from './pages/public/Login';
import { Register } from './pages/public/Register';
import { VerifyEmail } from './pages/public/VerifyEmail';
import { NotFound } from './pages/public/NotFound';

import { Dashboard } from './pages/volunteer/Dashboard';
import { Matches } from './pages/volunteer/Matches';
import { CompleteProfile } from './pages/volunteer/CompleteProfile';
import { StaffDashboard } from './pages/staff/StaffDashboard';

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/verify-email', element: <VerifyEmail /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    // Role-gated on the client (UX only — see ProtectedRoute security note).
    element: <ProtectedRoute role="volunteer" />,
    children: [
      {
        path: '/volunteer',
        element: <VolunteerLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'matches', element: <Matches /> },
          { path: 'profile', element: <CompleteProfile /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute role="staff" />,
    children: [
      {
        path: '/staff',
        element: <StaffLayout />,
        children: [{ index: true, element: <StaffDashboard /> }],
      },
    ],
  },
]);
