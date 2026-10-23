ARG RUBY_VERSION=3.4.10
FROM ruby:${RUBY_VERSION}
ARG GEM_REVISION=bd17ca6b3df9f620a70a3b01a5dd41cf04e8c5f3
ARG RAILS_VERSION=8.1.3.1
RUN git clone --branch feat/cloud-websockets https://github.com/WendellAdriel/laravel-cloud-rails.git /gem && git -C /gem checkout "$GEM_REVISION"
WORKDIR /gem
RUN ruby -e 'file = "Gemfile"; File.write(file, File.read(file).sub(/gem "rails", "[^"]+"/, "gem \"rails\", \"#{ENV.fetch("RAILS_VERSION")}\""))' && bundle install
CMD ["bundle", "exec", "rake", "test"]
