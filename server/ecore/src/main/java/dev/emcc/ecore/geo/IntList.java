package dev.emcc.ecore.geo;

import java.util.Arrays;

/** A growable int array; removal swaps the last element in (order does not matter here). */
final class IntList {

  private int[] values = new int[4];
  private int size;

  void add(int value) {
    if (size == values.length) {
      values = Arrays.copyOf(values, size * 2);
    }
    values[size++] = value;
  }

  boolean remove(int value) {
    for (int i = 0; i < size; i++) {
      if (values[i] == value) {
        values[i] = values[--size];
        return true;
      }
    }
    return false;
  }

  void clear() {
    size = 0;
  }

  /** Removes and returns the last value; the list is not empty. */
  int removeLast() {
    return values[--size];
  }

  int get(int i) {
    return values[i];
  }

  int size() {
    return size;
  }
}
