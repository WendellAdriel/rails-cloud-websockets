threads_count = ENV.fetch("RAILS_MAX_THREADS", 8).to_i
threads threads_count, threads_count
workers ENV.fetch("WEB_CONCURRENCY", 2).to_i
bind "tcp://[::]:#{ENV.fetch("PORT", 3000)}"
