package dev.emcc.plugins.simulator;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import java.util.UUID;

/** The messages of the engine worker, which owns the simulation's state. */
sealed interface EngineMsg extends Message {

  /** What a write to the store was. */
  enum Write {
    /** A track's move, not saved (ADR-0041). */
    MOVE,
    /** A track's saved update: placed on its route, stopped, or paused. */
    PLACE,
    /** The server part's write of a route's object list (brief functions 9a and 10). */
    ROUTE,
    /** A sensor platform's saved update of its relations, when it is on no route (function 30). */
    RELATIONS
  }

  /** The control commands (brief function 14). */
  enum Action {
    START,
    PAUSE,
    RESET
  }

  /** The store subscription on the Simulation workspace: a snapshot, or changes. */
  record Updated(StoreUpdate update) implements EngineMsg {}

  /** The answer to the query a restarted worker makes for its picture. */
  record Found(QueryResult result) implements EngineMsg {}

  /** The timer, once a second. */
  record Tick() implements EngineMsg {}

  /** The store's answer to one of the engine's writes to object {@code id}. */
  record Written(UUID id, Write write, ChangeOutcome outcome) implements EngineMsg {}

  /** The store's answer to the creation of the first layer, "Simulation" (function 2, from M4). */
  record LayerCreated(ChangeOutcome outcome) implements EngineMsg {}

  /** {@code POST /routes/start|pause|reset}, or {@code POST /routes/{id}/start|pause|reset} for one route. */
  record Control(Action action, EndpointRequest request) implements EngineMsg {}

  /** {@code POST /put-on-route} (brief function 10). */
  record PutOnRoute(EndpointRequest request) implements EngineMsg {}

  /** {@code POST /take-off-route} (brief function 10). */
  record TakeOffRoute(EndpointRequest request) implements EngineMsg {}

  /** {@code GET /outputs} (brief function 18). */
  record GetOutputs(EndpointRequest request) implements EngineMsg {}

  /** {@code POST /outputs}: the chosen output channels. */
  record ChooseOutputs(EndpointRequest request) implements EngineMsg {}

  /** The output channels other plugins offer, from {@code channels().watch}. */
  record Channels(ChannelList list) implements EngineMsg {}

  /** The plugin's settings after an admin's change ({@code outputStaleSeconds}). */
  record Settings(JsonObject settings) implements EngineMsg {}

  /** The answer to one of the engine's document reads or writes (ADR-0041). */
  record Document(DocumentResult result) implements EngineMsg {}

  /** The plugin stops: pause and save, best effort (ADR-0041 point 6). */
  record Stop() implements EngineMsg {}

  /** {@code GET /routes}: every route with its state and computed values. */
  record GetRoutes(EndpointRequest request) implements EngineMsg {}

  /** {@code GET /routes/{id}}: one route. */
  record GetRoute(EndpointRequest request) implements EngineMsg {}

  /** {@code GET /sensors} (brief function 27): the sensors and the channels that take sensor reports. */
  record GetSensors(EndpointRequest request) implements EngineMsg {}

  /** {@code GET /sensors/dwells} (function 43). */
  record GetDwells(EndpointRequest request) implements EngineMsg {}

  /** {@code POST /sensors}: creates ({@code "create": true}) or changes one sensor. */
  record SaveSensor(EndpointRequest request) implements EngineMsg {}

  /** {@code POST /sensors/remove}: removes one sensor. */
  record RemoveSensor(EndpointRequest request) implements EngineMsg {}

  /** {@code GET /scenario-state} (brief function 32): the simulator's own part of a scenario. */
  record GetScenarioState(EndpointRequest request) implements EngineMsg {}

  /** {@code POST /scenario-state}: an imported scenario's own part, as new or merged. */
  record ImportScenarioState(EndpointRequest request) implements EngineMsg {}
}
