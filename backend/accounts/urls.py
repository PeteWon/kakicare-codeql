from django.urls import path

from .views import (
    AcceptInviteView,
    ChangePasswordView,
    LoginView,
    LogoutView,
    MeView,
    MFADisableView,
    MFASetupView,
    MFAStatusView,
    MFAVerifyView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    VerifyEmailView,
)

urlpatterns = [
    path('register', RegisterView.as_view(), name='auth-register'),
    path('verify-email', VerifyEmailView.as_view(), name='auth-verify-email'),
    path('accept-invite', AcceptInviteView.as_view(), name='auth-accept-invite'),
    path('login', LoginView.as_view(), name='auth-login'),
    path('logout', LogoutView.as_view(), name='auth-logout'),
    path('me', MeView.as_view(), name='auth-me'),
    path('change-password', ChangePasswordView.as_view(), name='auth-change-password'),
    path('mfa/setup', MFASetupView.as_view(), name='auth-mfa-setup'),
    path('mfa/verify', MFAVerifyView.as_view(), name='auth-mfa-verify'),
    path('mfa/status', MFAStatusView.as_view(), name='auth-mfa-status'),
    path('mfa/disable', MFADisableView.as_view(), name='auth-mfa-disable'),
    path('password-reset/request', PasswordResetRequestView.as_view(), name='auth-password-reset-request'),
    path('password-reset/confirm', PasswordResetConfirmView.as_view(), name='auth-password-reset-confirm'),
]
