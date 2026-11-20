# ADR-0013: OpenTelemetry and an in-app monitor view

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
Because plugins run work in parallel and communicate in many ways, advanced monitoring is required. The core must watch plugins' memory usage, thread count and so on. The web client has a monitor view. The application must work disconnected.

## Decision
- Logging uses the **SLF4J** API. Plugins get a logger from the SDK that tags every entry with the plugin id.
- Metrics and traces use **OpenTelemetry**. ECore records per plugin: workers and their states, mailbox depth, messages per second, handler time, hung events and approximate memory allocation.
- The **monitor view** in the web client shows the live health of core and plugins, using data from ECore.
- External dashboards (e.g. Prometheus and Grafana) can be connected through OTLP, but are optional and self-hosted.

## Alternatives considered
- **JMX only:** built into Java, but poorly suited for web dashboards and traces.
- **A vendor-specific monitoring agent:** often requires cloud access, which conflicts with disconnected operation.

## Consequences
- One open standard for logs, metrics and traces, usable with many self-hosted tools.
- Thread counts, queue lengths and processing times per plugin are exact, because ECore runs the workers.
- Memory per plugin is only approximate, since plugins share one process. The method is proven in spike S5, probably using Java Flight Recorder (JFR).
