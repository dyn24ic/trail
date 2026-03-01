FROM python:3.12-slim

WORKDIR /app

# System deps for rasterio/scipy
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libgdal-dev libproj-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Set a high socket timeout globally via pip.conf
RUN printf '[global]\ntimeout = 600\nretries = 10\n' > /etc/pip.conf

# Install heavy packages one at a time with a retry shell loop so a mid-download
# timeout retries only that package, not the whole list
RUN for pkg in \
      "numpy==2.4.2" \
      "scipy==1.17.1" \
      "rasterio==1.5.0" \
      "pyproj==3.7.2" \
      "pandas==3.0.1"; \
    do \
      until pip install --no-cache-dir "$pkg"; do \
        echo "Retrying $pkg ..."; sleep 3; \
      done; \
    done

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV DJANGO_SETTINGS_MODULE=trail_backend.settings \
    DEBUG=False \
    ALLOWED_HOSTS=* \
    DB_PATH=/app/db/trail.db

EXPOSE 8000
# Migrate at startup so the shared volume is mounted before the DB is created
CMD ["sh", "-c", "mkdir -p /app/db && python manage.py migrate --run-syncdb && gunicorn trail_backend.wsgi:application --bind 0.0.0.0:8000 --workers 4 --threads 2 --timeout 120 --access-logfile - --error-logfile -"]
