# Rails Cloud WebSockets lab

Exercise ordinary Rails channels with the official Action Cable and AnyCable clients against Laravel Reverb. The demo installs `rails-on-cloud` from [your fork](https://github.com/WendellAdriel/laravel-cloud-rails/tree/feat/cloud-websockets). It contains no copy of the bridge gem.

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

`Gemfile.lock` pins the fork commit used by the image. The default stack has no source mounts or Bundler local override. Verify it with:

```bash
docker compose exec rails1 bundle show rails-on-cloud
```

For gem development only, an optional overlay mounts the adjacent `../laravel-cloud-rails` checkout:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait
```

An additional `compose.anycable.yaml` fixture starts the app with an existing `adapter: any_cable` configuration and channel prefix. The bridge must activate without editing that configuration. Remove overlays with `docker compose up -d --wait` before validating the Git installation.

## Try the demo

Switch between Action Cable and AnyCable using the page links. Each tab has a Rails session. A new browser context creates an independent guest account.

The controls exercise channel actions, controller broadcasts, direct replies, custom JSON coders, `stream_for`, actual AnyCable whisper commands, periodic transmissions, Rails application presence, unsubscribe, reconnect, logout, and remote access revocation. Creating a report exercises a model callback and a Turbo Stream. Turbo navigation checks that the transport is not installed twice.

After revoking access, click Log out and follow a client link to create a fresh guest session. After logging out, following a client link is enough.

The Web Worker button runs the AnyCable SDK without the injected HTML transport. It connects to Rails' native `/cable` route and shares Reverb broadcasts through the gem's subscription adapter.

Guest creation and the diagnostic `/up` and `/audit` endpoints belong to this test harness. Existing applications should retain their own authentication and connection authorization.

## Run validations

Run these sequentially. Fault tests restart this demo's Reverb container and kill its Puma worker processes, so concurrent suites would interfere with each other.

```bash
bin/validate-gem
bin/validate all
```

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

The seven original validation areas are tracked separately from the AnyCable broker release gates below.

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

The 2026-10-23 run used fork commit `bd17ca6` and the Git-installed production image:

| Check | Result |
| --- | --- |
| Gem suite | 86 tests and 277 assertions pass; Rails 7.1.6 / Ruby 3.2.11 and Rails 8.1.3.1 / Ruby 3.4.10 were checked. |
| Protocol contracts | 16 pass. |
| Browser clients | 15 Chromium checks and 10 Firefox/WebKit checks pass. |
| Fault injection | 5 pass. |
| Repeated load | Six waves of 200 clients deliver 12,000 messages with zero duplicates; connections return to their starting level or below. |
| Delivery latency | Local p95 is 369-477 ms across the six waves; the largest observed delivery is 570 ms. |
| Memory | After the sixth wave, Rails container RSS is approximately 394 and 400 MiB; Reverb uses 40 MiB. RSS remains allocated after connection cleanup. |
| Pusher backend capabilities | 4 checks pass over HTTP and HTTPS, covering live delivery, cache retention, and presence membership. |
| AnyCable broker gates | 3 fail at extended-protocol negotiation. |

These short runs measure this lab. They do not establish a production capacity limit or a long-term memory plateau. Raw per-wave Docker samples and worker counts are retained in `.localfiles/results/load-wave-*.json`.

To repeat the churn check and preserve each report:

```bash
for wave in 1 2 3 4 5 6; do
    bin/load
    cp .localfiles/results/load.json ".localfiles/results/load-wave-$wave.json"
done
```

## AnyCable release gates

Run the outstanding acceptance checks separately:

```bash
bin/validate readiness
```

These checks must pass before claiming full AnyCable feature parity. The bridge currently handles the default `actioncable-v1-json` protocol. It does not implement AnyCable's extended protocol, missed-message replay, session recovery across worker loss, or broker presence API. Ordinary Rails presence and reconnect/resubscribe coverage do not prove those features.

The release gates require extended-protocol connections, offline catch-up, and the presence SDK API. All three currently stop at extended-protocol negotiation; recovery and presence assertions must then pass once that handshake is implemented. The gates are not skipped or counted as passing tests.

### Pusher-only integration

The integration must use only the six injected `PUSHER_*` variables. It must not add database tables or require Redis, NATS, or another storage service. The demo's PostgreSQL database belongs to the application and is not a broker store.

`bin/validate backend` checks Reverb 1.12.0 directly through the Pusher protocol. Ordinary channels deliver live events without replaying earlier broadcasts. A cache channel sends a late subscriber only the latest event while another subscriber keeps the channel occupied. Reverb deletes the cached event when the last subscriber leaves and discards publications to an empty channel. Presence channels expose current members and remove a user after their final connection closes.

Those cache semantics do not provide a retained message log or session store. A Rails memory cache would also disappear when all Rails processes restart. Recovery across that loss cannot be guaranteed by the current backend contract. Extended-protocol handling and translation of Pusher presence remain implementation work. Pusher's presence support does not make those gates pass automatically. All three gates remain required and failing.

AnyCable itself offers memory, NATS JetStream, and Redis broker storage through AnyCable Pro. It does not use the Rails SQL database for broker history by default. Its memory broker also loses data on restart. Reusing SQL would require a custom storage adapter and tables, which the Pusher-only constraint excludes. See [AnyCable broker storage](https://docs.anycable.io/anycable-go/reliable_streams#cache-backends), [client reliability](https://docs.anycable.io/js/reliability), and [broker presence](https://docs.anycable.io/anycable-go/presence).

## Prepare a Cloud deployment

No Cloud resources have been created and nothing has been deployed. Complete the release gates first.

Push this demo to a Git repository, connect that repository to Cloud, select its Rails stack, and attach PostgreSQL and managed WebSockets. Keep the locked fork dependency; do not copy the local gem or use a Bundler path override. Cloud's Rails integration supplies `DATABASE_URL`, `SECRET_KEY_BASE`, and the six `PUSHER_*` variables.

Use these application commands:

| Phase | Command |
| --- | --- |
| Build | `bin/cloud-build` |
| Deploy migration | `bundle exec rails db:prepare` |
| Start | `bundle exec puma -C config/puma.rb` |
| Readiness | `/up` |

`Procfile` declares the same start command. Puma binds to the IPv6 wildcard and reads `PORT`, `WEB_CONCURRENCY`, and `RAILS_MAX_THREADS`. Asset compilation uses npm and Rails' pipeline. Cloud runs the Rails app; the Compose Reverb, proxy, certificates, and PostgreSQL containers are local test infrastructure.

Before a Cloud trial, verify the real injected values, browser/backend reachability, host origin and HTTPS forwarding, deployment restarts, replica scaling, and access revocation against Cloud's managed resource. Keep resource credentials in Cloud, outside Git.
