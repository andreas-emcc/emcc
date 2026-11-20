package dev.emcc.ecore.store;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * One layer's object ids in id order, for its pages (CR-0015 item 9). The order of UUID v7 ids is
 * the order of their creation; it is also the order of their lowercase text. Kept current with
 * every change, in sorted blocks of at most {@link #BLOCK} ids (like a B-tree's leaves): adding or
 * removing an id costs a binary search and one block's copy, and a page costs finding its block
 * plus its own size, however large the layer and however much it changes (conformance review F1:
 * one sorted array cost the object store about 0.45 s to build and 40 ms per page after changes for
 * a layer of a million objects). About 4 to 8 bytes per id, but a block's whole {@link #BLOCK} slots
 * from the first id: about 4 to 8 KB for a layer of one object.
 *
 * <p>Not thread-safe: owned by {@link PictureState}.
 */
final class LayerOrder {

  /** Unsigned, as the ids' text: {@link UUID#compareTo} compares signed. */
  static final Comparator<UUID> ID_ORDER = Comparator.comparing(UUID::getMostSignificantBits, Long::compareUnsigned)
      .thenComparing(UUID::getLeastSignificantBits, Long::compareUnsigned);

  /** The most ids in one block; a full block is split in two. */
  static final int BLOCK = 1024;

  /** One block: its first {@code size} ids, sorted. */
  private static final class Block {
    final UUID[] ids;
    int size;

    Block(int capacity) {
      ids = new UUID[capacity];
    }

    UUID last() {
      return ids[size - 1];
    }

    int find(UUID id) {
      return Arrays.binarySearch(ids, 0, size, id, ID_ORDER);
    }
  }

  private final int blockSize;
  /** Sorted, none empty: every id of a block comes before every id of the next. */
  private final List<Block> blocks = new ArrayList<>();
  private int size;

  LayerOrder() {
    this(BLOCK);
  }

  /** With smaller blocks, so that tests split and drop blocks with few ids. */
  LayerOrder(int blockSize) {
    if (blockSize < 2) {
      throw new IllegalArgumentException("blocks hold at least 2 ids: " + blockSize);
    }
    this.blockSize = blockSize;
  }

  /** Adds an id it does not hold yet; one it holds is left as it is. */
  void add(UUID id) {
    if (blocks.isEmpty()) {
      blocks.add(new Block(blockSize));
    }
    int b = blockFor(id);
    Block block = blocks.get(b);
    int at = block.find(id);
    if (at >= 0) {
      return;
    }
    at = -at - 1;
    if (block.size == blockSize) {
      // Split in two halves, then add to the half it belongs in.
      Block upper = new Block(blockSize);
      int half = blockSize / 2;
      upper.size = blockSize - half;
      System.arraycopy(block.ids, half, upper.ids, 0, upper.size);
      Arrays.fill(block.ids, half, blockSize, null);
      block.size = half;
      blocks.add(b + 1, upper);
      if (at > half) {
        block = upper;
        at -= half;
      }
    }
    System.arraycopy(block.ids, at, block.ids, at + 1, block.size - at);
    block.ids[at] = id;
    block.size++;
    size++;
  }

  /** Removes an id; one it does not hold is ignored. */
  void remove(UUID id) {
    if (blocks.isEmpty()) {
      return;
    }
    int b = blockFor(id);
    Block block = blocks.get(b);
    int at = block.find(id);
    if (at < 0) {
      return;
    }
    System.arraycopy(block.ids, at + 1, block.ids, at, block.size - at - 1);
    block.ids[--block.size] = null;
    size--;
    if (block.size == 0) {
      blocks.remove(b);
    }
  }

  /** At most {@code count} ids from position {@code from} on; none past the end. */
  List<UUID> slice(long from, int count) {
    List<UUID> out = new ArrayList<>(Math.max(0, (int) Math.min(count, size - Math.min(from, size))));
    long skipped = 0;
    for (Block block : blocks) {
      if (out.size() >= count) {
        break;
      }
      if (skipped + block.size <= from) {
        skipped += block.size;
        continue;
      }
      int start = (int) Math.max(0, from - skipped);
      int end = Math.min(block.size, start + count - out.size());
      out.addAll(Arrays.asList(block.ids).subList(start, end));
      skipped += block.size;
    }
    return List.copyOf(out);
  }

  int size() {
    return size;
  }

  /** The block an id belongs in: the first whose last id is not before it, else the last block. */
  private int blockFor(UUID id) {
    int low = 0;
    int high = blocks.size() - 1;
    while (low < high) {
      int mid = (low + high) >>> 1;
      if (ID_ORDER.compare(blocks.get(mid).last(), id) < 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }
}
