from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('volunteers', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='volunteerdocument',
            name='checksum_sha256',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='volunteerdocument',
            name='checksum_mismatch',
            field=models.BooleanField(default=False),
        ),
    ]
