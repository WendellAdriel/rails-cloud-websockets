FROM node:24-bookworm-slim AS assets
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY app/javascript app/javascript
RUN npm run build

FROM ruby:3.4.10
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle install
COPY . .
COPY --from=assets /app/app/assets/builds app/assets/builds
RUN SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production bundle exec rails assets:precompile
ENV RAILS_ENV=production RAILS_LOG_TO_STDOUT=1
CMD ["bundle", "exec", "puma", "-C", "config/puma.rb"]
