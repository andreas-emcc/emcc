# A data platform: options for the owner

- **Status:** written by the ACA on 2026-11-05, at the owner's request, **for a later milestone, not M5** (owner, 2026-11-05). Nothing is decided. When a milestone takes it up, spike S8 (overview section 7) checks the chosen option, and ADRs record the decisions (section 8).
- **Question:** how emc2 stores its data so that a local LLM can answer questions about it, and so that nodes can share it with resilience and scale.
- **Sources:** written from the ACA's general knowledge on 2026-11-03 to 2026-11-05. **Versions, licences and limits were not checked for this paper.** Spike S8 checks each one, as spike S1 did for mil-sym-ts.

## The owner's goals (2026-11-03)

| Goal | What |
|---|---|
| D1 | A **local LLM** answers questions from the data and makes layers from them. Examples: *"a new layer with all tracks in the Stockholm archipelago moving eastwards at 4 to 19 knots"*; *"have any two ships stopped in about the same spot?"* The owner wants the LLM to work **directly on the data**, without slow API calls, and to know where named areas are, without a gazetteer. |
| D2 | **Any storage technology** is on the table: SQL, NoSQL, vector databases or something else. |
| D3 | **Synchronization between nodes**, and a product that works with a cloud and a data lake, with resilience and scale. |

The owner: a robust, well-built design matters more than reaching the goal fast.

## 1. Where emc2 stands

- **Every change is an ordered change event** from one writer (ADR-0005). ADR-0005 chose not to make the events the only stored truth yet, but kept that path open: history is planned as an append-only log of the events, and timeline playback as replaying it.
- **The store holds the current state only.** The file store's journal is compacted. **PostgreSQL with PostGIS** behind the persistence manager (ADR-0024) is **M6's** (owner, 2026-11-05), as a separate local service, since PostGIS is GPL-2.0.
- **The data model already helps:**
  - creator-chosen UUIDv7 ids, so nodes cannot collide;
  - versions with `baseVersion`, and `externalRef`;
  - a security label on every object and layer;
  - coordinates in WGS84, longitude first;
  - `speed` (m/s) and `direction` (degrees) as numbers.
- **What is missing:**
  - **history:** where each object was, and when;
  - **a query language on the server:** across space, time and attributes, with joins;
  - **ownership between nodes:** sequence numbers are gapless per server (data model rule 7), and there is one server.
- **Rules that any design keeps:**
  - **the server enforces permissions** (overview 4.4), later labels too;
  - **objects change only through change requests** (ADR-0005);
  - **storage only through the persistence manager** (ADR-0024);
  - **everything works offline** (ADR-0030);
  - **the single-node release** stays possible.

## 2. What the goals need

The two examples need these capabilities. Each one is useful without an LLM too.

| | Capability | Example 1 (eastwards, 4–19 kn) | Example 2 (two ships stopped) |
|---|---|---|---|
| C1 | **History of positions**, at a known rate and retention | – | Needed: stops are found in the past track |
| C2 | **A query language** over space, time and attributes, with joins | A polygon, a course of about 45–135°, 2.1–9.8 m/s | A spatial self-join: stops matched against stops |
| C3 | **Query layers:** a layer defined by a query, kept up to date by the server as events arrive. Today an object is in exactly one layer, so a copy would duplicate it | "a new layer that shows…" | The result as a layer |
| C4 | **Named areas**, offline | "the Stockholm archipelago" | "in the area defined by [a drawn shape]": the selected shape (ADR-0032) |
| C5 | **Ownership and replication** between nodes | – | – (D3) |
| C6 | **Scale-out and an archive** for long histories | – | Months of AIS |

Example 2 is a classic maritime analysis (spotting ship-to-ship transfers) in three steps:
1. find each ship's **stops**: speed below a threshold for some minutes;
2. **cluster** the stops of different ships by distance, and by overlapping time if wanted;
3. keep the clusters inside the given area.

## 3. The options for storage

| | A: event log, PostgreSQL read models, data lake | B: no SQL: document and vector stores | C: data lake only | D: a scale-first trajectory store |
|---|---|---|---|---|
| What | The change events as the record; PostgreSQL with **PostGIS**, **MobilityDB** and **pgvector** as read models; **GeoParquet + Apache Iceberg** queried by **DuckDB** for history | A document store (CouchDB, OpenSearch) for objects, a vector database (Qdrant, Milvus) for search, our own code for the rest | GeoParquet files with DuckDB on one node, Trino or Apache Sedona in a cluster; no database server | GeoMesa over Cassandra, HBase or Accumulo, or TimescaleDB |
| Example 1 | **One query** | Geo queries in OpenSearch; the course and speed filter by hand | One query, on data some seconds to minutes old | One query |
| Example 2 | **One query**; stops built into MobilityDB | Our own code: no joins | One query, as a batch | Partly; the join by hand |
| Exact filters, joins | **Yes** | Partly (OpenSearch); vector search is approximate by design | Yes | Partly |
| Live updates, transactions | **Yes** | Yes (document store) | **No**: files are written in batches | Partly |
| The LLM's query language | **SQL**, which models know best, spatial SQL included | Several APIs, each its own | SQL | GeoMesa's CQL, or SQL with TimescaleDB |
| Permissions per row | **Row-level security** in the database | Per index or document, in our code | In the query engine, or our code | Per row in Accumulo; otherwise our code |
| One offline node | **Yes**: one PostgreSQL, Parquet files, DuckDB | Yes | Yes | Heavy: a cluster |
| Scale-out | Read replicas, partitions, the data lake | Good | **Very good** | **Very good** |
| Licences (not checked yet) | PostgreSQL License (a CR), PostGIS GPL-2.0 as a separate service (as ADR-0024), MobilityDB and pgvector PostgreSQL License, DuckDB MIT, Iceberg Apache-2.0 | CouchDB, OpenSearch, Qdrant, Milvus Apache-2.0; MongoDB (SSPL) and Couchbase (BSL) are out | DuckDB MIT; Trino, Sedona Apache-2.0 | GeoMesa, Cassandra, HBase, Accumulo Apache-2.0; TimescaleDB partly under the Timescale licence |
| Effort | **Medium**, in steps | High: the analyses are our code | Medium, but needs a live store beside it | High: a cluster to run |
| Fits the architecture | **Yes**: projections of ADR-0005's events behind ADR-0024 | Partly | As A's history tier | As A's history tier at very large scale |

### Option A: event log, PostgreSQL read models, data lake

**CQRS with event sourcing**, close to what emc2 does already. The ordered change events are the record of what happened. Every store is a **projection** of them, rebuilt from them when needed:
- the current state;
- the trajectories;
- the search index;
- the data lake.

One design then scales from a laptop to a cloud: one PostgreSQL, Parquet files and DuckDB on a single node; replicas, a replicated log and object storage in a cloud.

| Role | Recommended | Alternatives |
|---|---|---|
| Current state, spatial queries, query layers | **PostgreSQL + PostGIS** (M6, ADR-0024) | OpenSearch as an extra search index |
| History of positions and stops | **MobilityDB** in the same PostgreSQL | TimescaleDB (only its Apache-2.0 part), GeoMesa for very large volumes |
| Text and semantic search (reports, documents, retrieval for the LLM) | **pgvector** in the same PostgreSQL | Qdrant, Milvus |
| The event log: history, replication, the data lake's feed | A table at first; **NATS JetStream** when clustered | Kafka |
| Data lake and archive | **GeoParquet + Apache Iceberg** on S3-compatible storage, with **DuckDB** on one node, Trino or Sedona in a cluster | GeoMesa on Parquet |

MinIO is AGPL; an S3-compatible store under a permissive licence, such as SeaweedFS (Apache-2.0), fits instead.

### Option B: no SQL (the owner's question of 2026-11-03)

The owner asked what emc2 would lose without SQL, which "feels not in line with modern AI-driven data storage". It helps to separate **SQL the language** from **a database server**. Modern AI data stacks are queried in SQL, even "databaseless" data lakes (DuckDB, Trino, Spark and Sedona over Parquet), and text-to-SQL is one of the most mature uses of LLMs.

**What emc2 would lose without SQL:**
- **Spatial power:** PostGIS is the most complete spatial engine available. Without it, the geo queries left are OpenSearch's, or MongoDB's, which the licence policy rules out.
- **Joins:** Example 2 is a spatial self-join. Without SQL, emc2 writes it in its own code.
- **Trajectories:** MobilityDB's moving-object types and stop detection exist for PostgreSQL only.
- **Exact filters:** vector databases find similar things. That is right for "reports like this one" and wrong for "between 4 and 19 knots inside this polygon".
- **Mature operations:** transactions, constraints, backups, replication, failover, and simple single-node operation for the offline release.

**What emc2 would gain:** schema flexibility, which PostgreSQL's JSON columns already give for plugin extensions, and horizontal scale, which the data lake gives too.

**Where B's parts fit in A:** a vector index for text, and OpenSearch as a search index, both as projections.

### Option C: data lake only

The data lake with no database server is SQL without a server, and scales best. But it is written in batches, so it cannot hold the live picture, and it has no transactions. In A it is the history and archive tier.

### Option D: a scale-first trajectory store

Built for billions of positions, at the cost of running a cluster even on one node. It is A's alternative history tier, if the volumes in a deployment outgrow MobilityDB and the data lake.

## 4. How the LLM reaches the data

The owner wants the LLM to work directly on the data, without slow API calls. The time goes to the LLM, though: a query passing through the server adds milliseconds, while a local model writing it takes seconds.

| | L1: a direct database connection (the owner's) | L2: the LLM writes SQL, the server checks and runs it | L3: typed API tools |
|---|---|---|---|
| Expressive | Fully | **Fully**: one "run this query" tool | Only what the tools offer |
| Speed | Fast | **As fast**: milliseconds more than L1 | As fast |
| Permissions (overview 4.4) | **Bypassed**: the LLM sees every workspace, later every label | **Kept**: row-level security with the user's rights on every row | Kept |
| Writes ("a new layer") | Bypass the change events: browsers, plugins, history and other nodes never see them (ADR-0005) | **Change requests**, as every write | Change requests |
| Audit, tests | Hard | **Every query logged and repeatable** | Easy |
| Needs | An ADR overturning a non-negotiable rule | An SDK CR for a query service in ECore, since plugins store only through the persistence manager (ADR-0024) | An SDK CR per tool |

**Recommended: L2.**
- **Where queries run:** on a **read-only copy** of the data, never the live store.
- **Who sees what:** **row-level security** applies the user's permissions, workspaces and later labels.
- **What is accepted:** reading statements only, with a time limit and a size limit, and every query is logged.
- **Before it runs:** the query can be shown to the user in words, for example "eastwards as a course of 45–135°, 4–19 kn as 2.1–9.8 m/s", and confirmed.

**Running the LLM:**
- **as an external service** on a GPU server, as Keycloak is today: llama.cpp or Ollama (MIT), or vLLM (Apache-2.0); this works air-gapped;
- **model weights' licences vary:** some Mistral and Qwen models are Apache-2.0, Llama has its own licence;
- **connected through the Model Context Protocol:** an `ai` plugin provides the tools in its server part and a chat panel in its web part;
- **tested with a fixed set of prompts** and their expected queries, so that a new model cannot change behaviour unnoticed.

## 5. Named areas: the LLM proposes, the user confirms

The owner: a local LLM knows where "the Stockholm archipelago" is, so emc2 needs no gazetteer. That is partly true. A good model gives a plausible outline, but:
- the outline is approximate, and differs between runs and models;
- it can be confidently wrong, above all for less famous places, and nothing in the result shows it;
- in C2, an area a few kilometres off silently takes in or leaves out tracks: the answer looks right and isn't.

**A design that keeps the owner's idea:**
1. the LLM proposes the area;
2. emc2 draws it on the map;
3. the user confirms or adjusts it before the query runs;
4. the confirmed area is kept as a **named area**, so that it is exact and the same next time.

No gazetteer is built up front; one grows from use, and the human check catches the mistakes.

Possible seeds, offline, to be checked:
- **Natural Earth's** marine and region polygons (public domain, coarse; shipping them would extend CR-0009's use);
- **GeoNames** (CC BY 4.0, points only);
- **OpenStreetMap** is share-alike (ODbL), so its data stays out of the product.

## 6. Synchronization between nodes, resilience and scale

Two different problems:

| | A. Resilience and scale at one site | B. Federation between nodes (sites, vehicles, ships) |
|---|---|---|
| Network | Fast and reliable | Disconnected, intermittent, limited |
| Consistency | Strong for writes | Eventual; each node works alone (in ADR-0030's spirit) |
| How | One writer per partition; replicas serve the browsers from the event stream; PostgreSQL with failover (Patroni, MIT); a replicated log (NATS JetStream or Kafka) | Store-and-forward of change events, filtered per link by area, layers and classification |

**For B, ownership is the key decision:**
- **A home node** for every object, usually the one that created or received it (recommended). Others hold copies, and their changes go to the home node as change requests. This matches how C2 systems treat authoritative sources.
- **Multi-master with CRDTs** (Automerge, Yjs; MIT) has no owner, but is hard with geometries and security rules.

**To be added for either:**
- a node id;
- hybrid logical clocks instead of one global sequence;
- a conflict policy;
- labels enforced per link, which is a cross-domain question.

**Between nations' C2 systems,** NATO's **MIP 4 (MIP4-IES)** is the exchange standard. It would be an in/out plugin built by the playbook, and its replication principles are worth borrowing for B.

**In a cloud:**
- stateless edge and live-picture nodes on Kubernetes;
- PostgreSQL with failover;
- the replicated log;
- the data lake on object storage.

Every one of these is a deployment choice behind the persistence manager (ADR-0024), never a requirement, so the single-node release zip stays.

## 7. Tensions to settle in ADRs

1. **The single writer and rule 7** (one gapless sequence per server) do not scale writes across a cluster: one writer per partition, or sequences per node.
2. **Unsaved simulation moves** (ADR-0041) against analysing history: a trajectory store could sample them at a lower rate, apart from the journal.
3. **Volume:** an AIS feed can reach about 1 000 positions a second, tens of millions of rows a day. That needs trajectory compression, retention rules and downsampling, with the data lake for long-term history.
4. **Height and time references,** as in the 3D paper ([`3d-view.md`](3d-view.md)).
5. **The LLM's access:** L1 would overturn overview 4.4 and ADR-0005, both non-negotiable rules today.

## 8. Relation to M6's PostgreSQL persistence

PostgreSQL with PostGIS comes in M6, before this platform. One choice there makes this paper cheaper later: an **append-only event table** with the current state as a projection, instead of the current state only. History, query layers and synchronization could then come without a data migration. M6's plan should put that choice to the owner, with its cost; this paper does not decide it.

## 9. Spike S8 (when a milestone takes it up)

Question: can option A, with access L2, answer the owner's two examples from a local LLM, offline, at AIS volumes on one node? Pass marks:

1. A recorded day of AIS (the ESA's playback) loaded, and 1 000 positions a second kept up with on one node.
2. Example 1 over 24 hours of data in under 1 s; Example 2, stops and clusters, in under 10 s.
3. A local LLM, run as an external service, turns a fixed set of about 30 prompts, the two examples among them, into queries that return the expected results; the share that does is reported.
4. Row-level security: a user without a workspace gets no row from its layers, also through LLM-written SQL that tries to escape (changing role, functions with side effects, writing statements).
5. The read-only copy stays less than a second behind.
6. Coordinates tested with a point where latitude ≠ longitude, and distances geodesic.
7. Named areas: the LLM's outline of three areas compared with a reference outline, to measure what the user's check has to catch.
8. Nothing leaves the local network, and every package's version, licence and notices are checked.

## 10. Questions for the owner, when a milestone takes it up

1. **Storage:** option A (recommended), B, C or D.
2. **The LLM's access:** L2 (recommended), L1 with an ADR changing overview 4.4, or L3.
3. **Named areas:** proposed by the LLM and confirmed on the map (recommended), or used as the LLM gives them.
4. **M6:** an event-sourced PostgreSQL store (section 8), or the current state only.
5. **Federation:** a home node per object (recommended), or multi-master.
6. **History:** retention, sampling rate, and whether unsaved simulation moves are kept.
7. **The LLM service:** which model and weights' licence, and which GPU server the ESA runs it on.
8. **MIP4-IES:** in scope, and when.

## 11. Effort, roughly

To be estimated again after the spike. As a first view, several milestones:
- **history:** the event log, the trajectories and the PostGIS read model (CDA; data model and SDK CRs by the PDA);
- **querying:** the query service, query layers, named areas, and the `ai` plugin with its prompt tests (CDA, PDA, a new PCA, ITA; the LLM service by the ESA);
- **the data lake:** export and archive (CDA, MCA);
- **federation:** node ids, clocks, ownership, links (CDA, PDA; an ADR each);
- **a cluster deployment** (CDA, MCA, ESA).
