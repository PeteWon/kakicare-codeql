"""Management command: flag confirmed sessions as 'missed'.

Run this on a schedule (e.g. every 5 minutes via cron or Celery beat) to
transition sessions that were never checked into from 'confirmed' to 'missed'
after the grace period has elapsed.

Grace period is configured via SESSION_MISSED_GRACE in settings (default: 30
minutes). This gives some tolerance for sessions that ran slightly over time
before the volunteer was able to check out.
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from sessions.models import Session


class Command(BaseCommand):
    help = (
        'Mark confirmed sessions as missed when scheduled_end + grace period '
        'has passed without a check-in.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print sessions that would be flagged without updating them.',
        )

    def handle(self, *args, **options):
        grace = getattr(settings, 'SESSION_MISSED_GRACE', 30)
        cutoff = timezone.now() - timedelta(minutes=grace)

        qs = Session.objects.filter(
            status=Session.Status.CONFIRMED,
            scheduled_end__lt=cutoff,
        )

        if options['dry_run']:
            ids = list(qs.values_list('pk', flat=True))
            self.stdout.write(
                f'Dry run: {len(ids)} session(s) would be flagged as missed: {ids}'
            )
            return

        updated = qs.update(status=Session.Status.MISSED)
        self.stdout.write(
            self.style.SUCCESS(f'Flagged {updated} session(s) as missed.')
        )
