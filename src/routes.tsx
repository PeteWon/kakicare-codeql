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
import { ForgotPassword } from './pages/public/ForgotPassword';
import { ResetPassword } from './pages/public/ResetPassword';
import { NotFound } from './pages/public/NotFound';

import { Dashboard } from './pages/volunteer/Dashboard';
import { Matches } from './pages/volunteer/Matches';
import { CompleteProfile } from './pages/volunteer/CompleteProfile';
import { BookSession } from './pages/volunteer/BookSession';
import { SessionDetail } from './pages/volunteer/SessionDetail';
import { StaffDashboard } from './pages/staff/StaffDashboard';
import { Applications } from './pages/staff/Applications';
import { ApplicationDetail } from './pages/staff/ApplicationDetail';
import { Seniors } from './pages/staff/Seniors';
import { SeniorDetail } from './pages/staff/SeniorDetail';
import { SeniorForm } from './pages/staff/SeniorForm';
import { StaffMatches } from './pages/staff/StaffMatches';
import { ProposeMatch } from './pages/staff/ProposeMatch';
import { Sessions } from './pages/staff/Sessions';

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/verify-email', element: <VerifyEmail /> },
      { path: '/forgot-password', element: <ForgotPassword /> },
      { path: '/reset-password', element: <ResetPassword /> },
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
          { path: 'matches/:matchId/book', element: <BookSession /> },
          { path: 'sessions/:id', element: <SessionDetail /> },
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
        children: [
          { index: true, element: <StaffDashboard /> },
          { path: 'applications', element: <Applications /> },
          { path: 'applications/:id', element: <ApplicationDetail /> },
          { path: 'seniors', element: <Seniors /> },
          // seniors/new must be listed before seniors/:id so the static segment wins.
          { path: 'seniors/new', element: <SeniorForm /> },
          { path: 'seniors/:id', element: <SeniorDetail /> },
          { path: 'seniors/:id/edit', element: <SeniorForm /> },
          // matches/new must be listed before any future matches/:id route.
          { path: 'matches', element: <StaffMatches /> },
          { path: 'matches/new', element: <ProposeMatch /> },
          { path: 'sessions', element: <Sessions /> },
        ],
      },
    ],
  },
]);
