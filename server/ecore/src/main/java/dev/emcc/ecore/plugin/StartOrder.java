package dev.emcc.ecore.plugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.TreeSet;

/**
 * Orders plugins for the start (overview 4.1): a plugin starts after the plugins it depends on
 * ({@code dependsOn}) and after the providers of the web services it requires or uses ({@code requires},
 * {@code uses}: a provider that is loaded comes first; the PDA's D4 review, owner: as the shell's {@code plan.ts}),
 * so that the shell can activate in the same order. Plugins whose dependencies are missing, or
 * that are part of a cycle, or depend ({@code dependsOn}) on such a one, are rejected with a reason; a {@code uses} key nobody provides is
 * never a reason. Ties are broken by id, so the
 * order is the same on every start.
 *
 * @param order the plugins to start, in start order
 * @param rejected the plugins left out, by id, with the reason
 */
record StartOrder(List<PluginManifest> order, Map<String, String> rejected) {

  StartOrder {
    order = List.copyOf(order);
    rejected = Map.copyOf(rejected);
  }

  static StartOrder of(List<PluginManifest> manifests) {
    Map<String, PluginManifest> byId = new LinkedHashMap<>();
    manifests.forEach(m -> byId.put(m.id(), m));
    Map<String, String> rejected = new LinkedHashMap<>();
    // In rounds, as the shell's plan.ts (the PDA's D4 review, owner): refusals spread through dependsOn; then the
    // plugins on a cycle are refused, and only they; the next round spreads that and orders the rest again.
    while (true) {
      boolean changed = true;
      while (changed) { // a plugin that depends on a rejected one is rejected too
        changed = false;
        for (PluginManifest m : byId.values()) {
          if (rejected.containsKey(m.id())) {
            continue;
          }
          for (String dependency : m.dependsOn()) {
            if (dependency.equals(m.id())) {
              continue; // itself: no edge, as plan.ts
            }
            String reason = !byId.containsKey(dependency) ? "depends on " + dependency + ", which is not installed"
                : rejected.containsKey(dependency) ? "depends on " + dependency + ", which is left out" : null;
            if (reason != null) {
              rejected.put(m.id(), reason);
              changed = true;
              break;
            }
          }
        }
      }

      Map<String, Set<String>> before = new HashMap<>(); // id -> the ids that start before it
      Map<String, List<String>> after = new HashMap<>();
      for (PluginManifest m : byId.values()) {
        if (rejected.containsKey(m.id())) {
          continue;
        }
        Set<String> first = new TreeSet<>(m.dependsOn());
        first.remove(m.id());
        for (PluginManifest provider : byId.values()) {
          if (provider != m && !rejected.containsKey(provider.id())
              && provider.provides().stream().anyMatch(k -> m.requires().contains(k) || m.uses().contains(k))) {
            first.add(provider.id());
          }
        }
        before.put(m.id(), first);
        first.forEach(f -> after.computeIfAbsent(f, k -> new ArrayList<>()).add(m.id()));
      }

      Map<String, Integer> waiting = new HashMap<>();
      PriorityQueue<String> ready = new PriorityQueue<>();
      before.forEach((id, first) -> {
        waiting.put(id, first.size());
        if (first.isEmpty()) {
          ready.add(id);
        }
      });
      List<PluginManifest> order = new ArrayList<>();
      Set<String> done = new HashSet<>();
      while (!ready.isEmpty()) {
        String id = ready.poll();
        order.add(byId.get(id));
        done.add(id);
        for (String next : after.getOrDefault(id, List.of())) {
          if (waiting.merge(next, -1, Integer::sum) == 0) {
            ready.add(next);
          }
        }
      }
      if (order.size() == before.size()) {
        return new StartOrder(order, rejected);
      }
      Set<String> cyclic = new TreeSet<>(); // those left that reach themselves; those behind them wait for the next round
      for (String id : before.keySet()) {
        if (!done.contains(id) && reaches(before, done, id, id, new HashSet<>())) {
          cyclic.add(id);
        }
      }
      cyclic.forEach(id -> rejected.put(id, "part of a cycle of dependsOn, requires and uses among " + cyclic));
    }
  }

  private static boolean reaches(Map<String, Set<String>> before, Set<String> done, String from, String to, Set<String> seen) {
    for (String d : before.getOrDefault(from, Set.of())) {
      if (d.equals(to)) {
        return true;
      }
      if (!done.contains(d) && seen.add(d) && reaches(before, done, d, to, seen)) {
        return true;
      }
    }
    return false;
  }
}
