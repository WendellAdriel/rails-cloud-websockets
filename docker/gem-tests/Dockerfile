ARG RUBY_VERSION=3.4.10
FROM ruby:${RUBY_VERSION}
ARG GEM_REVISION=e92653560d63cb6f700b9a0ef48bd9478793c612
ARG RAILS_VERSION=8.1.3.1
ARG REDIS_VERSION=5.4.1
RUN git clone --branch feat/cloud-websockets https://github.com/WendellAdriel/laravel-cloud-rails.git /gem && git -C /gem checkout "$GEM_REVISION"
WORKDIR /gem
RUN ruby -e 'file = "Gemfile"; File.write(file, File.read(file).sub(/gem "rails", "[^"]+"/, "gem \"rails\", \"#{ENV.fetch("RAILS_VERSION")}\""))' && ruby -e 'File.open("Gemfile", "a") { |file| file.puts "\ngem \"redis\", \"#{ENV.fetch("REDIS_VERSION")}\"" }' && bundle install
COPY test/client_compatibility.rb /compatibility.rb
CMD ["bundle", "exec", "rake", "test"]
