"""Project-wide DRF pagination.

Single definition of the standard page-number pagination used by every list
endpoint. Previously this identical class was copy-pasted into each app's views
(accounts, concerns, matching, seniors, sessions, volunteers).
"""

from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100
