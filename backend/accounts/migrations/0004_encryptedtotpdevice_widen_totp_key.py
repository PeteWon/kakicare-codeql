import re

from django.db import migrations

_HEX_RE = re.compile(r'^[0-9a-fA-F]+$')


def encrypt_existing_keys(apps, schema_editor):
    from accounts.encryption import encrypt_totp_key
    TOTPDevice = apps.get_model('otp_totp', 'TOTPDevice')
    for device in TOTPDevice.objects.all():
        if device.key and _HEX_RE.match(device.key):
            device.key = encrypt_totp_key(device.key)
            device.save(update_fields=['key'])


def decrypt_existing_keys(apps, schema_editor):
    from accounts.encryption import decrypt_totp_key
    TOTPDevice = apps.get_model('otp_totp', 'TOTPDevice')
    for device in TOTPDevice.objects.all():
        if device.key and not _HEX_RE.match(device.key):
            device.key = decrypt_totp_key(device.key)
            device.save(update_fields=['key'])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_staffinvitetoken'),
        ('otp_totp', '0003_add_timestamps'),
    ]

    operations = [
        migrations.RunSQL(
            sql='ALTER TABLE otp_totp_totpdevice ALTER COLUMN key TYPE varchar(500);',
            reverse_sql='ALTER TABLE otp_totp_totpdevice ALTER COLUMN key TYPE varchar(80);',
        ),
        migrations.CreateModel(
            name='EncryptedTOTPDevice',
            fields=[],
            options={
                'proxy': True,
                'indexes': [],
                'constraints': [],
            },
            bases=('otp_totp.totpdevice',),
        ),
        migrations.RunPython(encrypt_existing_keys, decrypt_existing_keys),
    ]
