# nginx image — builds the React SPA and serves it alongside a reverse-proxy
# to the Django backend container.
#
# Multi-stage so the final image carries only nginx + the built static files,
# never node_modules or the toolchain.

# ---- Stage 0: compile headers-more-nginx-module --------------------------------
# Compiled with --with-compat so the .so is ABI-stable against the exact binary
# shipped in the final stage (both stages share the same nginx:1.31-alpine base).
FROM nginx:1.31-alpine AS module-builder

ARG HEADERS_MORE_VERSION=0.37

RUN apk add --no-cache build-base openssl-dev pcre2-dev zlib-dev wget ca-certificates \
    && NGINX_VER=$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+') \
    && wget -q "https://nginx.org/download/nginx-${NGINX_VER}.tar.gz" \
    && tar -xzf "nginx-${NGINX_VER}.tar.gz" \
    && wget -q "https://github.com/openresty/headers-more-nginx-module/archive/refs/tags/v${HEADERS_MORE_VERSION}.tar.gz" \
         -O headers-more.tar.gz \
    && tar -xzf headers-more.tar.gz \
    && cd "nginx-${NGINX_VER}" \
    && ./configure \
         --with-compat \
         "--add-dynamic-module=../headers-more-nginx-module-${HEADERS_MORE_VERSION}" \
    && make modules \
    && cp objs/ngx_http_headers_more_filter_module.so /

# ---- Stage 1: build the SPA --------------------------------------------------
FROM node:26-alpine AS frontend-build

WORKDIR /build

# Copy lockfile and manifest first so npm install caches when only code changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Now bring the source in and produce the production bundle.
COPY frontend/ .
# VITE_API_BASE_URL is empty so the frontend uses relative URLs (/api/...)
# served by THIS nginx — no cross-origin requests in production.
ENV VITE_API_BASE_URL=""
RUN npm run build

# ---- Stage 2: nginx image ----------------------------------------------------
FROM nginx:1.31-alpine

# headers-more module — used to suppress the Server response header (issue #55).
COPY --from=module-builder /ngx_http_headers_more_filter_module.so /usr/lib/nginx/modules/

# Replace default nginx.conf with one that loads the dynamic module at startup.
COPY nginx/nginx-main.conf /etc/nginx/nginx.conf

# Remove the default site config; replace with ours.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/conf.d/kakicare.conf

# Built SPA goes into the location nginx serves.
COPY --from=frontend-build /build/dist /usr/share/nginx/html

# Django staticfiles are mounted in at runtime via a named volume (see
# docker-compose.prod.yml). We just ensure the mount point exists.
RUN mkdir -p /usr/share/nginx/static

# Certbot writes HTTP-01 challenge files here; nginx serves them on port 80.
RUN mkdir -p /var/www/certbot

EXPOSE 80
EXPOSE 443

# Default CMD from the nginx base image is fine.
