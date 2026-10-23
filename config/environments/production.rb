Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = true
  config.consider_all_requests_local = false
  config.assume_ssl = false
  config.force_ssl = false
  config.public_file_server.enabled = true
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")
  config.logger = ActiveSupport::TaggedLogging.logger(STDOUT)
  config.active_support.report_deprecations = false
end
