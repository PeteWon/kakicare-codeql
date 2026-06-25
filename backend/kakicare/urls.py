"""
URL configuration for kakicare project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path
from django_otp.admin import OTPAdminSite

# SECURITY (admin-portal MFA): require a verified TOTP device to access the
# Django admin, not just a password. Re-classing the default site keeps every
# existing `@admin.register(...)` registration intact while adding the OTP gate
# (OTPAdminSite.has_permission also checks request.user.is_verified()).
# A superuser must have a confirmed TOTP device first — staff/admins enrol one
# via the app MFA flow; for a fresh bootstrap superuser with no device, use
# `manage.py addstatictoken <email>` to mint a one-time code for the first login.
admin.site.__class__ = OTPAdminSite

urlpatterns = [
    path('manage/portal/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/volunteer/', include('volunteers.urls')),
    path('api/volunteer/', include('matching.volunteer_urls')),
    path('api/volunteer/', include('sessions.volunteer_urls')),
    path('api/staff/', include('volunteers.staff_urls')),
    path('api/staff/', include('accounts.staff_urls')),
    path('api/staff/', include('seniors.staff_urls')),
    path('api/staff/', include('matching.staff_urls')),
    path('api/staff/', include('sessions.staff_urls')),
    path('api/staff/', include('audit.urls')),
]
