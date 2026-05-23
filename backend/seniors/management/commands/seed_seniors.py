"""Management command: seed fictional senior records for development/demo.

ALL data below is FICTIONAL — names, addresses, phone numbers, and next-of-kin
details are invented. They do not represent real people. Records are labelled
with '(DEMO)' in full_name so they are immediately recognisable in a UI.

These records represent seniors enrolled OFFLINE by staff before the digital
system went live. Seniors in this befriending programme do not self-register —
their records are created by staff on their behalf. This command satisfies the
design requirement for pre-populated seed data without requiring manual UI input.

Idempotent: re-running is safe. Records are matched on full_name; existing rows
are not modified. Run once per fresh database.

Usage:
    python manage.py seed_seniors
"""

from django.core.management.base import BaseCommand

from accounts.models import User
from seniors.models import Senior

_SEED_DATA = [
    {
        'full_name': 'Tan Ah Kow (DEMO)',
        'address': 'Blk 123 Ang Mo Kio Ave 6 #04-12 S(560123)',
        'phone_number': '+65 9000 0001',
        'preferred_language': 'Hokkien',
        'accessibility_needs': 'Uses a walking stick. Prefers ground-floor access.',
        'availability': {'Mon': ['Morning'], 'Wed': ['Morning'], 'Fri': ['Afternoon']},
        'notes': 'Enjoys chess and gardening. Lives alone.',
        'next_of_kin_name': 'Tan Wei Liang (DEMO)',
        'next_of_kin_contact': '+65 9000 0002',
        'is_active': True,
    },
    {
        'full_name': 'Lim Siew Eng (DEMO)',
        'address': 'Blk 456 Tampines St 21 #08-30 S(520456)',
        'phone_number': '+65 9000 0003',
        'preferred_language': 'Mandarin',
        'accessibility_needs': 'Wheelchair user. Lift access required.',
        'availability': {'Tue': ['Afternoon'], 'Thu': ['Afternoon'], 'Sat': ['Morning']},
        'notes': 'Enjoys knitting and Mandarin radio programmes.',
        'next_of_kin_name': 'Lim Jia Hui (DEMO)',
        'next_of_kin_contact': '+65 9000 0004',
        'is_active': True,
    },
    {
        'full_name': 'Rajan s/o Gopal (DEMO)',
        'address': 'Blk 789 Jurong West St 75 #12-05 S(640789)',
        'phone_number': '+65 9000 0005',
        'preferred_language': 'Tamil',
        'accessibility_needs': 'Hearing aid user — face them and speak clearly.',
        'availability': {'Mon': ['Afternoon', 'Evening'], 'Fri': ['Morning']},
        'notes': 'Former school teacher. Interested in reading and current affairs.',
        'next_of_kin_name': 'Priya Rajan (DEMO)',
        'next_of_kin_contact': '+65 9000 0006',
        'is_active': True,
    },
    {
        'full_name': 'Mdm Zainab bte Abdullah (DEMO)',
        'address': 'Blk 22 Bedok North Rd #03-14 S(460022)',
        'phone_number': '+65 9000 0007',
        'preferred_language': 'Malay',
        'accessibility_needs': 'Mild dementia — familiar faces reduce anxiety.',
        'availability': {'Wed': ['Morning', 'Afternoon'], 'Sat': ['Morning']},
        'notes': 'Enjoys baking. Prefers female volunteers.',
        'next_of_kin_name': 'Ahmad Firdaus (DEMO)',
        'next_of_kin_contact': '+65 9000 0008',
        'is_active': True,
    },
    {
        'full_name': 'Chan Poh Eng (DEMO)',
        'address': 'Blk 88 Toa Payoh Lorong 2 #07-22 S(310088)',
        'phone_number': '+65 9000 0009',
        'preferred_language': 'Cantonese',
        'accessibility_needs': 'Diabetic — visits should not involve food gifts.',
        'availability': {'Tue': ['Morning'], 'Thu': ['Morning'], 'Sun': ['Afternoon']},
        'notes': 'Retired hawker. Enjoys mah-jong and cooking stories.',
        'next_of_kin_name': 'Chan Mei Ling (DEMO)',
        'next_of_kin_contact': '+65 9000 0010',
        'is_active': True,
    },
    {
        'full_name': 'Wong Soo Fong (DEMO)',
        'address': 'Blk 5 Queenstown Rd #02-08 S(140005)',
        'phone_number': '+65 9000 0011',
        'preferred_language': 'Teochew',
        'accessibility_needs': '',
        'availability': {'Mon': ['Afternoon'], 'Thu': ['Morning'], 'Sat': ['Afternoon']},
        'notes': 'Sharp and sociable. Loves card games and local history.',
        'next_of_kin_name': 'Wong Kah Heng (DEMO)',
        'next_of_kin_contact': '+65 9000 0012',
        'is_active': True,
    },
    {
        'full_name': 'Nair Saraswathi d/o Krishnan (DEMO)',
        'address': 'Blk 301 Clementi Ave 4 #11-20 S(120301)',
        'phone_number': '+65 9000 0013',
        'preferred_language': 'Tamil',
        'accessibility_needs': 'Sight-impaired — audio companionship appreciated.',
        'availability': {'Tue': ['Morning', 'Afternoon'], 'Fri': ['Afternoon']},
        'notes': 'Enjoys classical Indian music and conversation.',
        'next_of_kin_name': 'Ravi Nair (DEMO)',
        'next_of_kin_contact': '+65 9000 0014',
        'is_active': True,
    },
    {
        'full_name': 'Ong Bak Chuan (DEMO)',
        'address': 'Blk 210 Bukit Batok St 21 #06-33 S(650210)',
        'phone_number': '+65 9000 0015',
        'preferred_language': 'Hakka',
        'accessibility_needs': '',
        'availability': {'Wed': ['Morning'], 'Sat': ['Morning', 'Afternoon']},
        'notes': 'Very active for his age. Enjoys walking and light exercise.',
        'next_of_kin_name': 'Ong Li Shan (DEMO)',
        'next_of_kin_contact': '+65 9000 0016',
        'is_active': False,  # no longer in programme — kept for audit trail
    },
]


class Command(BaseCommand):
    help = 'Seed fictional senior records for development/demo (idempotent)'

    def handle(self, *args, **options):
        # Use the first active staff user as the created_by for seed records.
        # In production, staff enrol seniors through the admin UI; this command
        # represents the batch of offline enrolments before the system went live.
        staff_user = User.objects.filter(role='staff', is_active=True).first()
        if staff_user is None:
            self.stderr.write(self.style.ERROR(
                'No active staff user found. '
                'Create one first before running this command.'
            ))
            return

        created = 0
        skipped = 0

        for data in _SEED_DATA:
            _, was_created = Senior.objects.get_or_create(
                full_name=data['full_name'],
                defaults={**data, 'created_by': staff_user},
            )
            if was_created:
                created += 1
                self.stdout.write(f'  Created: {data["full_name"]}')
            else:
                skipped += 1

        self.stdout.write(self.style.SUCCESS(
            f'\nDone. Created {created} senior record(s), '
            f'skipped {skipped} already-existing.'
        ))
