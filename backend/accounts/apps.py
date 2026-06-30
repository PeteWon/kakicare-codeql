from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'

    def ready(self):
        # SECURITY: django-otp's own device resolution (django_otp.device_classes,
        # used by the Django admin's OTP login via OTPAdminSite) explicitly
        # excludes proxy models, so it always resolves TOTP devices as the base
        # TOTPDevice, never our EncryptedTOTPDevice proxy. Without this patch the
        # admin login path reads the Fernet-encrypted key as if it were plain hex
        # and crashes. Patching the same encrypt/decrypt-aware bin_key/save onto
        # the base class fixes that. EncryptedTOTPDevice instances are unaffected:
        # their own class dict already defines these and takes precedence over
        # the patched base.
        from django_otp.plugins.otp_totp.models import TOTPDevice
        from .encryption import encrypt_totp_key
        from .models import EncryptedTOTPDevice, _HEX_RE

        # bin_key has no super() call, so the property can be copied directly.
        TOTPDevice.bin_key = EncryptedTOTPDevice.bin_key

        # save() uses a zero-arg super(), which Python compiles as
        # super(EncryptedTOTPDevice, self) at class-definition time. Copying
        # that function directly onto TOTPDevice.save would raise TypeError
        # for plain TOTPDevice instances, since they are not a subtype of
        # EncryptedTOTPDevice. Capture the original TOTPDevice.save before
        # patching and call it explicitly instead.
        _original_save = TOTPDevice.save

        def _save(self, *args, **kwargs):
            if self.key and _HEX_RE.match(self.key):
                self.key = encrypt_totp_key(self.key)
            _original_save(self, *args, **kwargs)

        TOTPDevice.save = _save
