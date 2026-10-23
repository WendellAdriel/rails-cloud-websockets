ARG RUBY_VERSION=3.4.10
FROM ruby:${RUBY_VERSION}
ARG GEM_REVISION=28cfd92624b6bca19bf099eca0e350a6af7e2877
ARG RAILS_VERSION=8.1.3.1
RUN git clone --branch feat/cloud-websockets https://github.com/WendellAdriel/laravel-cloud-rails.git /gem && git -C /gem checkout "$GEM_REVISION"
WORKDIR /gem
RUN ruby -e 'file = "Gemfile"; File.write(file, File.read(file).sub(/gem "rails", "[^"]+"/, "gem \"rails\", \"#{ENV.fetch("RAILS_VERSION")}\""))' && bundle install
CMD ["bundle", "exec", "rake", "test"]
