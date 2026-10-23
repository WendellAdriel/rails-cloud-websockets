FROM php:8.5-fpm-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git unzip && docker-php-ext-install pcntl && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /srv
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-scripts --prefer-dist
COPY . .
RUN mkdir -p bootstrap/cache storage/framework/cache storage/framework/views storage/framework/sessions storage/logs && php artisan package:discover
ENV APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr CACHE_STORE=array SESSION_DRIVER=array REVERB_APP_ID=cloud-demo REVERB_APP_KEY=cloud-demo-key REVERB_APP_SECRET=cloud-demo-secret REVERB_HOST=localhost REVERB_PORT=8080 REVERB_SCHEME=http
CMD ["php", "artisan", "reverb:start", "--host=0.0.0.0", "--port=8080"]
