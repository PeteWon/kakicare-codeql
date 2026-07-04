import json
import logging

from rest_framework import status
from rest_framework.parsers import BaseParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class CspReportParser(BaseParser):
    """Accept the application/csp-report content type browsers send."""
    media_type = 'application/csp-report'

    def parse(self, stream, media_type=None, parser_context=None):
        return json.loads(stream.read())


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
