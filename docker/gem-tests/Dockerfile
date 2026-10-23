ARG RUBY_VERSION=3.4.10
FROM ruby:${RUBY_VERSION}
ARG GEM_REVISION=aaf673db7d2bad894d8247d737ed093125f62625
ARG RAILS_VERSION=8.1.3.1
ARG REDIS_VERSION=5.4.1
RUN git clone --branch feat/cloud-websockets https://github.com/WendellAdriel/laravel-cloud-rails.git /gem && git -C /gem checkout "$GEM_REVISION"
WORKDIR /gem
RUN ruby -e 'file = "Gemfile"; File.write(file, File.read(file).sub(/gem "rails", "[^"]+"/, "gem \"rails\", \"#{ENV.fetch("RAILS_VERSION")}\""))' && ruby -e 'File.open("Gemfile", "a") { |file| file.puts "\ngem \"redis\", \"#{ENV.fetch("REDIS_VERSION")}\"" }' && bundle install
COPY test/client_compatibility.rb /compatibility.rb
CMD ["bundle", "exec", "rake", "test"]
