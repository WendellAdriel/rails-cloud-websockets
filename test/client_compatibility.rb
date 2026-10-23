gem "redis", ENV.fetch("REDIS_VERSION")
require "redis"
require "rails"
require "laravel_cloud"
require "laravel_cloud/websockets"
require "minitest/autorun"

class ClientCompatibilityTest < Minitest::Test
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
