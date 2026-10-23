# Rails Cloud WebSockets demo

Preparation only. No Rails application has been generated and nothing has been deployed.

## Goal

Use existing Action Cable and AnyCable channel and browser APIs with Laravel Cloud managed WebSockets through rails-on-cloud. The gem must read the six PUSHER_* variables Cloud injects, with no extra application configuration for the bridge.

## Gem checkout

- Fork: https://github.com/WendellAdriel/laravel-cloud-rails
- Local checkout: ../laravel-cloud-rails
- Feature branch: feat/cloud-websockets
- Upstream: https://github.com/laravel/laravel-cloud-rails

The prototype bridge files have been copied into the feature branch. Changes are uncommitted and unpushed. Review and approve the commit and push before installing this branch from GitHub.

The future Rails Gemfile will use:

```ruby
gem "rails-on-cloud", git: "https://github.com/WendellAdriel/laravel-cloud-rails.git", branch: "feat/cloud-websockets", require: "laravel_cloud"
```

Bundler must resolve and lock the published commit after the feature branch is pushed. The future deployment must use that Git dependency rather than a local path or a bundled gem copy.

## Continue here

1. Build the Rails demo in this repository with Action Cable and AnyCable examples, using the fork as its gem dependency.
2. Run actual Laravel Reverb in Docker. Test HTTP/WS and HTTPS/WSS through a local reverse proxy using the same six PUSHER_* variables.
3. Exercise multiple Rails workers and replicas behind a load balancer, worker restarts, and routing between processes. Resolve the current process-local connection registry before claiming support.
4. Test recovery after Rails and Reverb restarts, network interruptions, delayed command responses, and browser suspension. Check subscriptions and duplicate delivery.
5. Add browser coverage for both official clients, shared streams, multiple subscriptions, unsubscribe, reconnect, and long connections.
6. Check stream_for, model broadcasts, Turbo Streams, direct channel transmit, connection callbacks, and existing session authentication. Record unsupported behavior explicitly.
7. Verify authorization after logout and access revocation, including clients retaining a Pusher connection or subscription signature.
8. Exercise production mode, compiled assets, Turbo navigation, CSP, forwarded HTTPS headers, gem packaging, and installation from GitHub.
9. Measure memory, command latency, cleanup, and HTTP traffic under load. The current bridge sends an HTTP heartbeat every three seconds per connection.
10. After local validation, prepare Cloud build/start commands and perform a Cloud smoke test for real injected variables, networking, and deployment lifecycle.

## Existing prototype

The upstream gem checkout is unchanged.

The earlier prototype passed nine protocol integration tests and the existing gem suite of 73 tests with 225 assertions. Those results cover the earlier single-process Soketi setup, not the future Reverb or Cloud deployment.

Current limitations include process-local session state, unvalidated authorization revocation, unvalidated direct transmissions and lifecycle callbacks, HTML script injection, and HTTP heartbeats. This is not production-ready.
