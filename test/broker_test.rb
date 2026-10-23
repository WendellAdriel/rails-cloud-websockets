require_relative "../config/environment"
require "minitest/autorun"
require "securerandom"

class BrokerTest < Minitest::Test
  def setup
    @broker = LaravelCloud::Websockets::Broker.resolve
    raise "Run this suite with compose.valkey.yaml" unless @broker
    @stream = "broker-test:#{SecureRandom.hex(16)}"
  end

  def test_history_is_shared_between_independent_connections
    first = @broker.append(@stream, JSON.generate(text: "one"))
    second = @broker.append(@stream, JSON.generate(text: "two"))
    other = LaravelCloud::Websockets::Broker.resolve
    records = other.read(@stream, first.slice("epoch", "offset"))
    assert_equal [second], records
    assert_equal [second], other.read(@stream, first.slice("epoch", "offset"), since: Time.now.to_i - 3600)
  end

  def test_concurrent_publishers_get_one_epoch_and_unique_monotonic_positions
    publishers = Array.new(4) { LaravelCloud::Websockets::Broker.resolve }
    threads = publishers.map do |publisher|
      Thread.new { Array.new(10) { publisher.append(@stream, "{}") } }
    end
    records = threads.flat_map(&:value)
    assert_equal (1..40).to_a, records.map { |record| record.fetch("offset") }.sort
    assert_equal 1, records.map { |record| record.fetch("epoch") }.uniq.size
    assert_equal (1..40).to_a, @broker.read(@stream).map { |record| record.fetch("offset") }
  end

  def test_history_is_bounded_and_reports_evicted_positions
    first = @broker.append(@stream, "{}")
    110.times { @broker.append(@stream, "{}") }
    state = @broker.snapshot(@stream)
    assert_equal 100, state.fetch("entries").size
    assert_nil @broker.read(@stream, first.slice("epoch", "offset"))
  end

  def test_losing_the_stream_state_starts_an_epoch_and_discards_the_old_log
    first = @broker.append(@stream, "{}")
    connection = Redis.new(url: ENV.fetch("REDIS_URL"))
    connection.del(@broker.send(:keys, @stream).first)
    second = @broker.append(@stream, "{}")
    refute_equal first.fetch("epoch"), second.fetch("epoch")
    assert_nil @broker.read(@stream, first.slice("epoch", "offset"))
    assert_equal [second], @broker.read(@stream)
  ensure
    connection&.close
  end

  def test_missing_history_is_rejected_even_without_a_previous_stream_position
    assert_nil @broker.read(@stream, {}, since: Time.now.to_i)
    @broker.append(@stream, "{}")
    connection = Redis.new(url: ENV.fetch("REDIS_URL"))
    connection.del(@broker.send(:keys, @stream).last)
    assert_nil @broker.read(@stream, {}, since: Time.now.to_i)
  ensure
    connection&.close
  end

  def test_oversized_broadcasts_are_rejected_before_entering_history
    assert_raises(LaravelCloud::Websockets::InvalidCommand) { @broker.append(@stream, "x" * 10000) }
    assert_equal 0, @broker.snapshot(@stream).fetch("offset")
  end

  def test_an_existing_anycable_broadcast_connection_keeps_its_overridden_settings
    previous = AnyCable.broadcast_adapter if AnyCable.instance_variable_defined?(:@broadcast_adapter)
    url = AnyCable.config.redis_url
    AnyCable.broadcast_adapter = [:redis, { url: ENV.fetch("REDIS_URL"), ssl_params: { verify_mode: OpenSSL::SSL::VERIFY_PEER } }]
    adapter = AnyCable.broadcast_adapter
    AnyCable.config.redis_url = "redis://127.0.0.1:1"
    entry = LaravelCloud::Websockets::Broker.resolve.append(@stream, JSON.generate(text: "existing connection"))
    assert_equal "existing connection", JSON.parse(entry.fetch("payload")).fetch("text")
  ensure
    AnyCable.config.redis_url = url
    adapter&.redis_conn&.close
    if previous
      AnyCable.broadcast_adapter = previous
    elsif AnyCable.instance_variable_defined?(:@broadcast_adapter)
      AnyCable.send(:remove_instance_variable, :@broadcast_adapter)
    end
  end

  def test_authenticated_tls_rejects_a_hostname_outside_the_server_certificate
    original = AnyCable.config.redis_url
    AnyCable.config.redis_url = original.sub("@valkey:", "@valkey-wrong-host:")
    assert_raises(LaravelCloud::Websockets::Unavailable) do
      LaravelCloud::Websockets::Broker.resolve.snapshot(@stream)
    end
  ensure
    AnyCable.config.redis_url = original
  end
end
