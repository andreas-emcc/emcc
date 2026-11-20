package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.LocalFolder;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** SDK 1.4.0 part 6: the local folder's types (CR-0030 part 6). */
class Part6TypesTest {

  private static final Instant T = Instant.parse("2026-11-07T12:00:00Z");

  @Test
  void wellFormedPathsAreRelativeWithSlashes() {
    assertThat(List.of("", "n59.dt2", "dted/e015/n59.dt2", "../x", "a/./b")).allMatch(LocalFolder::isWellFormed);
    assertThat(List.of("/etc", "dted/", "a//b", "C:/x", "c:x", "a\\b", "a\0b")).noneMatch(LocalFolder::isWellFormed);
  }

  @Test
  void aListingIsSortedAndCapped() {
    var listing = new FolderResult.Listing("", List.of(new FolderResult.Entry("b", false, 1, T), new FolderResult.Entry("a", true, 0, T)));
    assertThat(listing.entries()).extracting(FolderResult.Entry::name).containsExactly("a", "b");
    var many = new ArrayList<FolderResult.Entry>();
    for (int i = 0; i <= LocalFolder.MAX_ENTRIES; i++) {
      many.add(new FolderResult.Entry("e" + i, false, 0, T));
    }
    assertThatThrownBy(() -> new FolderResult.Listing("", many)).hasMessageContaining("at most 10000");
  }

  @Test
  void entriesAndReadsCheckTheirValues() {
    assertThatThrownBy(() -> new FolderResult.Entry("a/b", false, 0, T)).hasMessageContaining("one name");
    assertThatThrownBy(() -> new FolderResult.Entry("", false, 0, T)).hasMessageContaining("one name");
    assertThatThrownBy(() -> new FolderResult.Entry("a", false, -1, T)).hasMessageContaining("size");
    assertThatThrownBy(() -> new FolderResult.Read("a", -1, Bytes.empty(), 0)).hasMessageContaining("not negative");
    FolderResult r = new FolderResult.Failed("x", FolderResult.Reason.OUTSIDE, "outside");
    assertThat(r.path()).isEqualTo("x");
    assertThat(LocalFolder.MAX_READ_BYTES).isEqualTo(64 * 1024 * 1024);
  }
}
