package dev.emcc.plugins.uavsimulation;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import java.util.UUID;

/** The messages of the {@code cameras} worker, which owns the cameras and their state. */
sealed interface CameraMsg extends Message {

  /** The store subscription on the Simulation workspace: a snapshot, or changes. */
  record Updated(StoreUpdate update) implements CameraMsg {}

  /** The output channels on offer, from {@code channels().watch}: the current list, then each change (brief function 9). */
  record Outputs(ChannelList list) implements CameraMsg {}

  /** The answer to the query made when changes come before any snapshot. */
  record Found(QueryResult result) implements CameraMsg {}

  /** A running camera's frame timer (brief function 7). */
  record Tick(UUID camera) implements CameraMsg {}

  /** The status timer: once a minute, for the per-minute counts (brief function 10). */
  record Report() implements CameraMsg {}

  /** The answer to a read or write of a plugin document. */
  record Document(DocumentResult result) implements CameraMsg {}

  /** {@code GET /cameras}. */
  record Get(EndpointRequest request) implements CameraMsg {}

  /** {@code POST /cameras}: a new camera. */
  record Create(EndpointRequest request) implements CameraMsg {}

  /** {@code POST /cameras/{id}}: a change. */
  record Change(EndpointRequest request) implements CameraMsg {}

  /** {@code POST /cameras/{id}/remove}. */
  record Remove(EndpointRequest request) implements CameraMsg {}

  /** {@code POST /cameras/{id}/start}. */
  record Start(EndpointRequest request) implements CameraMsg {}

  /** {@code POST /cameras/{id}/stop}. */
  record Stop(EndpointRequest request) implements CameraMsg {}
}
