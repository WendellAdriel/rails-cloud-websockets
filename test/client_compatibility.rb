gem "redis", ENV.fetch("REDIS_VERSION")
require "redis"
require "rails"
require "laravel_cloud"
require "laravel_cloud/websockets"
require "minitest/autorun"

class ClientCompatibilityTest < Minitest::Test
  def test_cloud_url_enables_history_without_the_anycable_ruby_extension
    refute defined?(AnyCable)
    broker = LaravelCloud::Websockets::Broker.resolve
    refute_nil broker
    stream = "plain-rails:#{SecureRandom.hex(16)}"
    entry = broker.append(stream, JSON.generate(text: "Cloud URL"))
    assert_equal [entry], broker.read(stream)
  end

  def test_the_selected_client_replays_history_over_authenticated_valkey_tls
    client = Redis.new(url: ENV.fetch("REDIS_URL"), ssl_params: { verify_mode: OpenSSL::SSL::VERIFY_PEER })
    broker = LaravelCloud::Websockets::Broker.new(client)
    stream = "client-matrix:#{SecureRandom.hex(16)}"
    first = broker.append(stream, JSON.generate(text: "first"))
    second = broker.append(stream, JSON.generate(text: "second"))
    assert_equal ENV.fetch("REDIS_VERSION"), Redis::VERSION
    assert_equal [second], broker.read(stream, first.slice("epoch", "offset"))
  ensure
    client&.close
  end
end
