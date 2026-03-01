from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=os.path.join(BASE_DIR, ".env.local"))


SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'dev-insecure-key')
DEBUG = os.getenv('DEBUG', 'True') == 'True'
ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
for host in ('django', 'django-1', 'nextjs', 'nextjs-1'):
    if host not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(host)

# DEBUG: Print OpenWeatherMap API key status at startup
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'routing',
    'weather',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'trail_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'trail_backend.wsgi.application'

_db_path = os.getenv('DB_PATH', str(BASE_DIR / 'db.sqlite3'))

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': _db_path,
        'OPTIONS': {
            # WAL mode allows concurrent reads + one writer without blocking
            'init_command': 'PRAGMA journal_mode=WAL;',
        },
    }
}

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS – allow all origins in dev
CORS_ALLOW_ALL_ORIGINS = DEBUG

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
}

# External API keys
OPENAI_API_KEY      = os.getenv('OPENAI_API_KEY', '')
OPENWEATHER_API_KEY = os.getenv('OPENWEATHER_API_KEY', '')

# Brev-hosted Nemotron inference server
# Set BREV_INFERENCE_URL to e.g. http://<brev-host>:8080 to enable Nemotron.
# When set, hotspot_service.py uses Nemotron instead of GPT-4o.
BREV_INFERENCE_URL = os.getenv('BREV_INFERENCE_URL', '')
BREV_API_KEY       = os.getenv('BREV_API_KEY', '')

# XGBoost trained model directory
# Set XGBOOST_MODEL_DIR to the directory containing:
#   hotspot_model.json, incident_type_model.json, label_encoder.json
# (produced by backend/training/04_xgboost/train_xgboost.py)
XGBOOST_MODEL_DIR = os.getenv(
    'XGBOOST_MODEL_DIR',
    str(BASE_DIR / 'training' / '04_xgboost' / 'models'),
)

# DEM tile cache directory
DEM_CACHE_DIR = BASE_DIR / 'dem_cache'
DEM_CACHE_DIR.mkdir(exist_ok=True)
