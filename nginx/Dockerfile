# nginx image — builds the React SPA and serves it alongside a reverse-proxy
# to the Django backend container.
#
# Multi-stage so the final image carries only nginx + the built static files,
# never node_modules or the toolchain.

# ---- Stage 1: build the SPA --------------------------------------------------
FROM node:20-alpine AS frontend-build

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
FROM nginx:1.27-alpine

# Remove the default site config; replace with ours.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/conf.d/kakicare.conf

# Built SPA goes into the location nginx serves.
COPY --from=frontend-build /build/dist /usr/share/nginx/html

# Django staticfiles are mounted in at runtime via a named volume (see
# docker-compose.prod.yml). We just ensure the mount point exists.
RUN mkdir -p /usr/share/nginx/static

EXPOSE 80

# Default CMD from the nginx base image is fine.
