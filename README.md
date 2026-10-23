# Rails Cloud WebSockets lab

Exercise ordinary Rails channels with the official Action Cable and AnyCable clients against Laravel Reverb. The demo installs `rails-on-cloud` from [the original gem's feature branch](https://github.com/laravel/laravel-cloud-rails/tree/feat/cloud-websockets). It contains no copy of the bridge gem.

- [Run locally](#run-locally)
- [Try the demo](#try-the-demo)
- [Run validations](#run-validations)
- [Validation coverage](#validation-coverage)
- [AnyCable release gates](#anycable-release-gates)
- [Prepare a Cloud deployment](#prepare-a-cloud-deployment)

## Run locally

Requirements: Docker with Compose, Git, and Python 3 for the test orchestration commands. Ruby, Rails, PHP, Node, PostgreSQL, Reverb, and Chromium run in containers.

```bash
bin/up
```

This builds the images, prepares the demo database through Rails migrations, and starts PostgreSQL, actual Laravel Reverb, two Rails replicas with two Puma workers each, and Nginx. It preserves existing database records.

The default stack uses HTTPS/WSS at `https://cloud-ws.localhost:3443`. A local CA is generated into a Docker volume. Ruby and Node validate the server certificate against that CA. Browser tests accept this disposable local certificate; no host trust settings are changed.

For manual testing without installing the local CA, switch the Rails backend settings to HTTP/WS:

```bash
docker compose -f compose.yaml -f compose.http.yaml up -d --wait
```

Open [the demo](http://127.0.0.1:3108). This profile changes only `PUSHER_PORT` and `PUSHER_SCHEME`. It adds no bridge configuration.

Return to HTTPS/WSS before running the default validation commands:

```bash
docker compose up -d --wait
```

Stop containers with `docker compose down`. Volumes retain the database and local certificates. Docker credentials, database passwords, and `SECRET_KEY_BASE` in Compose are disposable demo values.

### Gem installation

`Gemfile.lock` pins the gem commit used by the image. The default stack has no source mounts or Bundler local override. Verify it with:

```bash
docker compose exec rails1 bundle show rails-on-cloud
```

For gem development only, an optional overlay mounts the adjacent `../laravel-cloud-rails` checkout:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait
```

An additional `compose.anycable.yaml` fixture starts the app with an existing `adapter: any_cable` configuration and channel prefix. The bridge must activate without editing that configuration. Remove overlays with `docker compose up -d --wait` before validating the Git installation.

## Try the demo

Switch between Action Cable, AnyCable, and AnyCable + presence & replay using the page links. Each tab has a Rails session. A new browser context creates an independent guest account.

The controls exercise channel actions, controller broadcasts, direct replies, custom JSON coders, `stream_for`, actual AnyCable whisper commands, periodic transmissions, Rails application presence, unsubscribe, reconnect, logout, and remote access revocation. Creating a report exercises a model callback and a Turbo Stream. Turbo navigation checks that the transport is not installed twice.

With AnyCable + presence & replay selected, use Join and list members to join through the SDK, Leave presence to leave, and Join from the server to exercise Ruby `join_presence`. A history entry reports when the cache cannot replay missed messages.

After revoking access, click Log out and follow a client link to create a fresh guest session. After logging out, following a client link is enough.

The Web Worker button runs the AnyCable SDK without the injected HTML transport. It connects to Rails' native `/cable` route and shares Reverb broadcasts through the gem's subscription adapter.

Guest creation and the diagnostic `/up` and `/audit` endpoints belong to this test harness. Existing applications should retain their own authentication and connection authorization.

## Run validations

Run these sequentially. Fault tests restart this demo's Reverb container and kill its Puma worker processes, so concurrent suites would interfere with each other.

```bash
bin/validate-gem
bin/validate all
```

Protocol checks wait for the proxy to route requests after container replacement.

Individual suites:

```bash
bin/validate protocol
bin/validate backend
bin/validate browser
bin/validate engines
bin/validate-faults
bin/load
```

The gem suite can also exercise the declared minimum Rails version:

```bash
RUBY_VERSION=3.2 RAILS_VERSION=7.1.6 bin/validate-gem
```

`bin/load` defaults to 200 clients and ten broadcasts, checking 2,000 deliveries, duplicates, latency, all four workers, and connection cleanup. It saves Docker memory and CPU samples alongside the results. Set `CLIENTS` to change the connection count.

Reports and failed-browser traces are saved privately in `.localfiles/results/`. Set `DEMO_URL=http://127.0.0.1:3108` when validating the HTTP profile.

## Validation coverage

The seven original validation areas cover live transport, Rails behavior, security, and production execution. The AnyCable checks also cover presence and retained stream recovery.

| Area | Local coverage |
| --- | --- |
| Actual Reverb and TLS | Laravel Reverb 1.12.0, signed publish requests, authenticated private channels, HTTPS/WSS proxy, trusted CA checks in Ruby and Node, bounded TLS handshake failure. |
| Multiple workers and replicas | Two replicas and four Puma workers; commands route to their owning connection through Reverb; existing channel prefixes and AnyCable configuration are preserved. |
| Failure recovery | Both SDKs reconnect and resubscribe after Reverb and worker restarts, browser network loss, and delayed HTTP acknowledgements; paused timers expire server leases and resume. The timer test simulates throttling, rather than OS sleep. |
| Actual browser clients | Both official SDKs in Chromium, Firefox and WebKit, cross-client broadcasts, multiple subscriptions sharing one stream, independent unsubscribe, native Web Worker clients, and sustained connections with sparse leases. |
| Rails compatibility | Session authentication, rejected subscriptions, connection callbacks, direct and periodic transmit, custom stream blocks and coders, model streams, Turbo Streams, AnyCable state accessors, and authorized whispering. |
| Revocation | Logout and remote revocation stop delivery even when a malicious client retains its raw Pusher socket; stolen routing tokens, forged signatures, foreign origins, invalid commands, and oversized requests are rejected. |
| Production and load | Production Rails, compiled assets, nonce CSP, forwarded HTTPS, Git-installed gem, built `.gem` installation, 200-client fanout, memory samples, command deduplication, and connection cleanup. |

Connections work across Rails workers and replicas. Actual Reverb and both supported-version checks pass. The Cloud deployment itself has not been tested.

Callbacks, coders, timers, direct transmit, remote disconnect, Turbo, HTML/CSP, native clients, revocation, and heartbeats have local coverage. The gem uses one shared heartbeat per worker and one HTTP lease per browser connection every 30 seconds. Inactive connections expire after 90 seconds. This is a bounded local validation run, not a capacity guarantee for a production workload.

### Local results

The 2026-10-23 checks used Git-installed production images at `aaf673d` and
`1e3d8b5`. The final commit adds cache discovery without AnyCable's Ruby extension;
its Rails and Redis client matrices were rerun. The running demo pins that commit.

| Check | Result |
| --- | --- |
| Gem suite | 87 tests and 282 assertions pass on Rails 7.1.6 / Ruby 3.2 and Rails 8.1.3.1 / Ruby 3.4.10. |
| Packaged gem | Built and installed locally; the installed package loads its WebSockets components. |
| Protocol contracts | 19 pass, including Ruby presence helpers and isolated rejection of oversized subscriber frames. |
| Browser clients | 15 Chromium checks and 10 Firefox/WebKit checks pass. |
| Reverb-only fault injection | 5 pass, including worker and Reverb restarts, delayed acknowledgements, lease expiry, and native Web Worker recovery. |
| Reverb-only load | 200 clients receive 2,000 messages with zero duplicates; all four workers participate and every test connection is released. Local p95 is 241 ms and the largest observed delivery is 313 ms. |
| Valkey load | Six waves of 200 clients deliver 12,000 messages with zero duplicates and no remaining test connections. Local p95 is 218-237 ms; the largest delivery is 309 ms. |
| Existing AnyCable configuration | HTTP profile passes 19 protocol and 3 replay checks with the existing adapter and channel prefix. |
| Pusher backend capabilities | 4 checks pass over HTTP and HTTPS, covering live delivery, cache retention, and presence membership. |
| AnyCable presence and replay clients | 12 checks pass across Chromium, Firefox, and WebKit for negotiation, offline catch-up, presence, and protocol pong request volume. |
| Valkey fault injection | 4 pass for complete worker loss, Reverb restart, lost cache history, and presence rejoining. |
| Stream replay | 3 checks pass for authorized streams, custom callbacks and coders, multiple outputs per callback, overlapping replay, and invalid offsets. |
| Valkey contract | 8 checks and 16 assertions pass for shared history, concurrent offsets, bounded retention, cache loss, existing connection reuse, and TLS hostname validation. |
| Redis client compatibility | Redis 4.8.1 and 5.4.1 each pass 2 tests and 5 assertions against authenticated Valkey TLS, including discovery without the AnyCable Ruby extension. |

The cross-browser offline test closes the established connection after disabling
networking. Playwright's offline setting alone leaves existing WebSockets open in
Firefox and WebKit. Separate fault tests drop the backend connections directly.

These short runs measure this lab. They do not establish a production capacity
limit or a long-term memory plateau. Docker-reported memory after the Reverb-only
run is about 341 and 347 MiB for Rails and 38 MiB for Reverb. Raw Docker samples and
worker counts are retained in `.localfiles/results/load-git-reverb.json` and
`load-git-valkey-wave-*.json`. After the sixth Valkey wave, Docker reports about
347 and 354 MiB for Rails and 39 MiB for Reverb.

To repeat the churn check and preserve each report:

```bash
for wave in 1 2 3 4 5 6; do
    bin/load
    cp .localfiles/results/load.json ".localfiles/results/load-wave-$wave.json"
done
```

## AnyCable release gates

The extended protocol, offline replay, and presence checks use the official SDK. Run them with the optional Valkey fixture:

```bash
docker compose -f compose.yaml -f compose.valkey.yaml up -d --wait
bin/validate-broker
```

Add `-f compose.http.yaml` to the Compose command and set `DEMO_URL=http://127.0.0.1:3108` for manual HTTP testing. The Valkey fixture adds only `REDIS_URL` to the application, matching Cloud's attached-cache variable. It runs Valkey 9.1.2 with TLS and a dedicated demo user restricted to the replay commands and keys. No cache port is published on the host.

`bin/validate-broker` checks shared history and concurrent offsets against Valkey, runs the SDK acceptance checks in Chromium, Firefox, and WebKit, and injects worker, Reverb, and cache failures. The fault suite runs in Chromium. The tests distinguish reconnecting, replaying retained messages, restoring presence membership, and reporting unavailable history. Cache loss produces the SDK's channel `info` event with `type: 'history_not_found'` and permits fresh live delivery.

Check both supported Redis client versions against the same TLS fixture:

```bash
REDIS_VERSION=4.8.1 bin/validate-client
REDIS_VERSION=5.4.1 bin/validate-client
```

These checks build the gem revision pinned in `Gemfile.lock` and use its packaged Redis dependency.

### Reverb and optional Valkey

Live delivery, protocol negotiation, and presence use Reverb with the six `PUSHER_*` variables. Retained history uses Cloud's injected `REDIS_URL`, including apps using only AnyCable's JavaScript client. It can also reuse an application's existing AnyCable Redis configuration. The gem provides its Redis client dependency. It adds no SQL tables, NATS service, or bridge-specific application configuration.

The cache holds at most 100 messages per stream. Each publication renews the stream's five-minute expiry. Rails authenticates and subscribes again on reconnection, then replays available stream messages. History is rejected when its epoch changes, its requested offsets have been evicted, or its retained log is unavailable. Applications can use the SDK notification to reload their current state.

`bin/validate backend` checks Reverb directly through the Pusher protocol. Its cache channels keep only the latest event while occupied, delete it when the last subscriber leaves, and discard publications to empty channels. Those semantics cannot replace a retained message log across worker loss. Presence channels do provide the membership events used by the bridge.

The local fixture verifies authenticated TLS access and retained stream recovery. Verify managed-cache connectivity and deployment behavior during the Cloud trial.

See [AnyCable reliability](https://docs.anycable.io/js/reliability), [presence](https://docs.anycable.io/anycable-go/presence), and [Valkey compatibility](https://valkey.io/topics/migration/).

## Prepare a Cloud deployment

No Cloud resources have been created and nothing has been deployed. Run the local validation commands before a Cloud trial.

Push this demo to a Git repository, connect that repository to Cloud, select its Rails stack, and attach PostgreSQL and managed WebSockets. Keep the locked Git dependency; do not copy the local gem or use a Bundler path override. Cloud's Rails integration supplies `DATABASE_URL`, `SECRET_KEY_BASE`, and the six `PUSHER_*` variables. Attach Valkey to exercise retained history using the injected `REDIS_URL`.

Use these application commands:

| Phase | Command |
| --- | --- |
| Build | `bin/cloud-build` |
| Deploy migration | `bundle exec rails db:prepare` |
| Start | `bundle exec puma -C config/puma.rb` |
| Readiness | `/up` |

`Procfile` declares the same start command. Puma binds to the IPv6 wildcard and reads `PORT`, `WEB_CONCURRENCY`, and `RAILS_MAX_THREADS`. Asset compilation uses npm and Rails' pipeline. Cloud runs the Rails app; the Compose Reverb, proxy, certificates, and PostgreSQL containers are local test infrastructure.

Before a Cloud trial, verify the real injected values, browser/backend reachability, host origin and HTTPS forwarding, deployment restarts, replica scaling, and access revocation against Cloud's managed resource. Keep resource credentials in Cloud, outside Git.
