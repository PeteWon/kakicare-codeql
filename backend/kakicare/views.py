import json
import logging
import re

from django.conf import settings
from django.core.mail import send_mail
from rest_framework import status
from rest_framework.parsers import BaseParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class CspReportParser(BaseParser):
    """Accept the application/csp-report content type browsers send."""
    media_type = 'application/csp-report'

    def parse(self, stream, media_type=None, parser_context=None):
        return json.loads(stream.read())


class ContactRateThrottle(SimpleRateThrottle):
    """5 contact-form submissions per hour per source IP.

    Each submission triggers an outbound email. Without a throttle an attacker
    can flood the staff inbox and abuse the SMTP relay.
    """

    scope = 'contact'

    def parse_rate(self, rate):
        return (5, 3600)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class ContactView(APIView):
    """POST /api/contact/

    Accepts a public contact-form submission and e-mails it to the staff inbox.
    No authentication required.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ContactRateThrottle]

    _EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
    _PHONE_RE = re.compile(r'^(\+65)?[689]\d{7}$')

    def post(self, request):
        name = (request.data.get('name') or '').strip()
        email = (request.data.get('email') or '').strip()
        phone = (request.data.get('phone') or '').strip()
        message = (request.data.get('message') or '').strip()

        errors = {}
        if not name:
            errors['name'] = 'Name is required.'
        elif len(name) > 100:
            errors['name'] = 'Name must be 100 characters or fewer.'
        if not email:
            errors['email'] = 'Email is required.'
        elif len(email) > 254:
            errors['email'] = 'Enter a valid email address.'
        elif not self._EMAIL_RE.match(email):
            errors['email'] = 'Enter a valid email address.'
        if phone:
            if len(phone) > 20:
                errors['phone'] = 'Enter a valid Singapore phone number.'
            elif not self._PHONE_RE.match(phone.replace(' ', '')):
                errors['phone'] = 'Enter a valid Singapore phone number.'
        if not message:
            errors['message'] = 'Message is required.'
        elif len(message) > 2000:
            errors['message'] = 'Message must be 2000 characters or fewer.'

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        # Strip newlines from fields used in email headers to prevent injection.
        safe_name = name.replace('\n', ' ').replace('\r', ' ')
        staff_email = getattr(settings, 'CONTACT_EMAIL', settings.DEFAULT_FROM_EMAIL)
        body = f"Name: {name}\nEmail: {email}\nPhone: {phone or '—'}\n\n{message}"
        try:
            send_mail(
                subject=f'[KakiCare] Contact form message from {safe_name}',
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[staff_email],
                fail_silently=False,
            )
        except Exception:
            logger.exception('Failed to send contact form email from %s', email)
            return Response(
                {'detail': 'Could not send your message. Please try again later.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        logger.info('Contact form submission from %s <%s>', name, email)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CspReportView(APIView):
    """POST /api/csp-report/

    Receives Content Security Policy violation reports from browsers and logs
    them. No authentication required — browsers send reports anonymously.
    Returns 204 so browsers do not retry.
    """

    permission_classes = [AllowAny]
    parser_classes = [CspReportParser]

    def post(self, request):
        logger.warning('CSP violation: %s', request.data)
        return Response(status=status.HTTP_204_NO_CONTENT)
